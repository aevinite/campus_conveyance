-- 0043_ride_status.sql (idempotent)
-- Driver boarding/journey tracking + in-app notifications.
--
-- The driver panel was read-only. This adds the FIRST driver *write* path: a
-- driver taps a rider to record a journey stage (boarded → reached → got off).
-- Each stage writes the dormant `notifications` table for the student and every
-- linked parent, so families get an in-app update in real time.
--
-- All access is via SECURITY DEFINER RPCs, authorized by matching the caller's
-- auth.uid() to their own record (drivers have no institution, so RLS hides
-- rows). `ride_events` is RLS-locked with no client policies — the secure
-- default from 0002.

-- Journey stages a driver can record for a rider on a given day.
do $$ begin
  create type ride_stage as enum ('BOARDED', 'REACHED', 'GOT_OFF');
exception when duplicate_object then null; end $$;

create table if not exists ride_events (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  booking_id uuid not null references bookings(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  stage ride_stage not null,
  recorded_by uuid references profiles(id) on delete set null,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_ride_events_booking on ride_events(booking_id, recorded_at desc);
alter table ride_events enable row level security;

-- ---------------------------------------------------------------------------
-- Driver mutation: record a journey stage for one of the driver's riders and
-- fan out an in-app notification to the student + linked parents.
-- ---------------------------------------------------------------------------
create or replace function public.driver_mark_stage(p_booking_id uuid, p_stage text)
returns table (stage text, recorded_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_stage ride_stage;
  v_booking bookings;
  v_student_profile uuid;
  v_student_name text;
  v_bus text;
  v_college text;
  v_when timestamptz := now();
  v_time text;
  v_title text;
  v_body text;
  v_recipient uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'P0001';
  end if;

  -- Validate the requested stage against the enum.
  begin
    v_stage := p_stage::ride_stage;
  exception when others then
    raise exception 'Unknown ride stage: %', p_stage using errcode = 'P0002';
  end;

  -- Authorize: the booking must belong to a bus assigned to THIS driver.
  select b.* into v_booking
  from bookings b
  join routes r on r.id = b.route_id
  join vehicles v on v.id = r.vehicle_id
  join drivers d on d.id = v.driver_id and d.profile_id = v_uid
  where b.id = p_booking_id
  limit 1;
  if v_booking.id is null then
    raise exception 'This rider is not on one of your buses' using errcode = 'P0003';
  end if;

  -- Context for the notification message.
  select pr.id, coalesce(pr.full_name, v_booking.student_name)
    into v_student_profile, v_student_name
  from students s
  left join profiles pr on pr.id = s.profile_id
  where s.id = v_booking.student_id
  limit 1;

  select v.bus_number, i.name into v_bus, v_college
  from routes r
  left join vehicles v on v.id = r.vehicle_id
  left join institutions i on i.id = r.institution_id
  where r.id = v_booking.route_id
  limit 1;

  insert into ride_events (institution_id, booking_id, student_id, stage, recorded_by, recorded_at)
  values (v_booking.institution_id, v_booking.id, v_booking.student_id, v_stage, v_uid, v_when);

  -- Build a human, IST-timestamped message.
  v_time := to_char(v_when at time zone 'Asia/Kolkata', 'FMHH12:MI AM');
  v_student_name := coalesce(v_student_name, 'Your child');
  if v_stage = 'BOARDED' then
    v_title := 'Boarded the bus';
    v_body := v_student_name || ' boarded '
      || coalesce('Bus ' || v_bus, 'the bus') || ' at ' || v_time || '.';
  elsif v_stage = 'REACHED' then
    v_title := 'Reached ' || coalesce(v_college, 'campus');
    v_body := v_student_name || ' reached ' || coalesce(v_college, 'campus')
      || ' at ' || v_time || '.';
  else -- GOT_OFF
    v_title := 'Got off the bus';
    v_body := v_student_name || ' got off the bus at ' || v_time || '.';
  end if;

  -- Fan out: the student's own account + every linked parent account.
  for v_recipient in
    select v_student_profile where v_student_profile is not null
    union
    select pa.profile_id
    from parent_students ps
    join parents pa on pa.id = ps.parent_id
    where ps.student_id = v_booking.student_id and pa.profile_id is not null
  loop
    insert into notifications (institution_id, recipient_id, title, body)
    values (v_booking.institution_id, v_recipient, v_title, v_body);
  end loop;

  return query select v_stage::text, v_when;
end; $$;
grant execute on function public.driver_mark_stage(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Extend driver_bookings() with today's latest stage (drives the UI controls).
-- create-or-replace can't change the return signature, so drop first.
-- ---------------------------------------------------------------------------
drop function if exists public.driver_bookings();
create or replace function public.driver_bookings()
returns table (
  booking_id uuid, status text, created_at timestamptz,
  student_name text, student_phone text,
  bus_number text, route_name text, pickup_name text, college_name text,
  current_stage text
) language sql stable security definer set search_path = public as $$
  select b.id, b.status::text, b.created_at, pr.full_name, pr.phone,
         v.bus_number, r.name, ps.name, i.name,
         (select re.stage::text from ride_events re
            where re.booking_id = b.id
              and (re.recorded_at at time zone 'Asia/Kolkata')::date
                  = (now() at time zone 'Asia/Kolkata')::date
            order by re.recorded_at desc limit 1)
  from bookings b
  join routes r on r.id = b.route_id
  join vehicles v on v.id = r.vehicle_id
  join drivers d on d.id = v.driver_id and d.profile_id = auth.uid()
  left join institutions i on i.id = r.institution_id
  left join route_stops ps on ps.id = b.pickup_stop_id
  left join students s on s.id = b.student_id
  left join profiles pr on pr.id = s.profile_id
  where b.status in ('PENDING', 'CONFIRMED')
  order by b.created_at desc;
$$;
grant execute on function public.driver_bookings() to authenticated;

-- ---------------------------------------------------------------------------
-- Recipient-side notification RPCs (student / parent read their own inbox).
-- ---------------------------------------------------------------------------
create or replace function public.my_notifications()
returns table (id uuid, title text, body text, is_read boolean, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select n.id, n.title, n.body, n.is_read, n.created_at
  from notifications n
  where n.recipient_id = auth.uid()
  order by n.created_at desc
  limit 50;
$$;
grant execute on function public.my_notifications() to authenticated;

create or replace function public.unread_notification_count()
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from notifications
  where recipient_id = auth.uid() and is_read = false;
$$;
grant execute on function public.unread_notification_count() to authenticated;

create or replace function public.mark_notification_read(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update notifications set is_read = true
  where id = p_id and recipient_id = auth.uid();
$$;
grant execute on function public.mark_notification_read(uuid) to authenticated;

create or replace function public.mark_all_notifications_read() returns void
language sql security definer set search_path = public as $$
  update notifications set is_read = true
  where recipient_id = auth.uid() and is_read = false;
$$;
grant execute on function public.mark_all_notifications_read() to authenticated;
