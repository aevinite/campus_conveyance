-- 0056_substitute_driver_panel.sql (idempotent — requires 0022/0043/0044/0046)
-- Make today's SUBSTITUTE driver a first-class driver of the bus.
--
-- The driver-panel RPCs matched only vehicles.driver_id (the permanent driver),
-- so a driver set as today's substitute (bus_driver_changes.driver_id = them,
-- effective_date = today; added in 0046) saw "No bus assigned" — no riders, no
-- journey stages, and their GPS never reached the bus's families. Each RPC now
-- also counts the substitute assignment for today.

-- Vehicle ids the signed-in driver drives TODAY: permanently assigned OR today's
-- substitute. Central so every driver RPC agrees.
create or replace function public.driver_today_vehicle_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  with me as (select id from drivers where profile_id = auth.uid())
  select v.id from vehicles v where v.driver_id in (select id from me)
  union
  select dc.vehicle_id from bus_driver_changes dc
   where dc.driver_id in (select id from me)
     and dc.role = 'DRIVER'  -- a CONDUCTOR substitute must NOT get the driver panel
     and dc.effective_date = (now() at time zone 'Asia/Kolkata')::date;
$$;
grant execute on function public.driver_today_vehicle_ids() to authenticated;

-- driver_buses: buses the driver drives today (was: only vehicles.driver_id).
create or replace function public.driver_buses()
returns table (
  vehicle_id uuid, bus_number text, registration_no text, is_ac boolean, capacity int,
  bus_model text, bus_color text, image_url text,
  route_id uuid, route_name text, departure_time time, price_cents bigint,
  college_name text, stops_count bigint, seats_total int, seats_reserved int
) language sql stable security definer set search_path = public as $$
  select v.id, v.bus_number, v.registration_no, v.is_ac, v.capacity,
         v.bus_model, v.bus_color, v.image_url,
         r.id, r.name, r.departure_time, r.price_cents,
         i.name,
         (select count(*) from route_stops rs where rs.route_id = r.id),
         (select sa.total_seats from seat_allocations sa
            join route_assignments ra on ra.id = sa.route_assignment_id
            where ra.route_id = r.id limit 1),
         (select sa.reserved_seats from seat_allocations sa
            join route_assignments ra on ra.id = sa.route_assignment_id
            where ra.route_id = r.id limit 1)
  from vehicles v
  left join routes r on r.vehicle_id = v.id
  left join institutions i on i.id = r.institution_id
  where v.id in (select public.driver_today_vehicle_ids())
  order by v.bus_number nulls last;
$$;
grant execute on function public.driver_buses() to authenticated;

-- driver_bookings: riders on the buses the driver drives today (keeps 0043's
-- current_stage column; only the bus-ownership predicate changed).
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
  left join institutions i on i.id = r.institution_id
  left join route_stops ps on ps.id = b.pickup_stop_id
  left join students s on s.id = b.student_id
  left join profiles pr on pr.id = s.profile_id
  where b.status in ('PENDING', 'CONFIRMED')
    and v.id in (select public.driver_today_vehicle_ids())
  order by b.created_at desc;
$$;
grant execute on function public.driver_bookings() to authenticated;

-- driver_mark_stage: authorize on the buses the driver drives today. Body is
-- 0043's, with only the ownership SELECT widened to include the substitute.
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

  begin
    v_stage := p_stage::ride_stage;
  exception when others then
    raise exception 'Unknown ride stage: %', p_stage using errcode = 'P0002';
  end;

  -- Authorize: the booking must be on a bus this driver drives TODAY
  -- (permanent OR substitute).
  select b.* into v_booking
  from bookings b
  join routes r on r.id = b.route_id
  join vehicles v on v.id = r.vehicle_id
  where b.id = p_booking_id
    and v.id in (select public.driver_today_vehicle_ids())
  limit 1;
  if v_booking.id is null then
    raise exception 'This rider is not on one of your buses' using errcode = 'P0003';
  end if;

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
  else
    v_title := 'Got off the bus';
    v_body := v_student_name || ' got off the bus at ' || v_time || '.';
  end if;

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

-- bus_live_location: stream the EFFECTIVE driver's GPS for today — the
-- substitute if the agency changed the driver, else the permanent one — so a
-- family watching sees whoever is actually driving.
create or replace function public.bus_live_location(p_route_id uuid)
returns table (live boolean, lat double precision, lng double precision,
               updated_at timestamptz, bus_number text)
language sql stable security definer set search_path = public as $$
  select (coalesce(dl.is_online, false) and dl.updated_at > now() - interval '2 minutes') as live,
         case when coalesce(dl.is_online, false) and dl.updated_at > now() - interval '2 minutes'
              then dl.lat end,
         case when coalesce(dl.is_online, false) and dl.updated_at > now() - interval '2 minutes'
              then dl.lng end,
         dl.updated_at, v.bus_number
  from routes r
  join vehicles v on v.id = r.vehicle_id
  -- Only the DRIVER substitute matters for the live map — the location stream is
  -- the driver's. Without `role='DRIVER'` a CONDUCTOR substitute row (same bus,
  -- same day) would also match and make coalesce() follow the conductor's
  -- (usually offline) record, breaking the map even when the driver is online.
  left join bus_driver_changes dc
    on dc.vehicle_id = v.id and dc.role = 'DRIVER'
   and dc.effective_date = (now() at time zone 'Asia/Kolkata')::date
  left join driver_locations dl on dl.driver_id = coalesce(dc.driver_id, v.driver_id)
  where r.id = p_route_id
    and (
      exists (
        select 1 from bookings b join students s on s.id = b.student_id
        where b.route_id = p_route_id and s.profile_id = auth.uid()
      )
      or exists (
        select 1 from bookings b
        join students s on s.id = b.student_id
        join parent_students ps on ps.student_id = s.id
        join parents pa on pa.id = ps.parent_id
        where b.route_id = p_route_id and pa.profile_id = auth.uid()
      )
    )
  limit 1;
$$;
grant execute on function public.bus_live_location(uuid) to authenticated;
