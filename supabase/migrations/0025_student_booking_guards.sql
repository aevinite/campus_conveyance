-- 0025_student_booking_guards.sql (idempotent)
-- Student booking hardening:
--   1) An unpaid held (PENDING) seat expires after 30 minutes instead of
--      blocking the seat forever when a checkout is abandoned.
--   2) One ACTIVE booking per student per route (unique index + friendly error).
--   3) reserve_seat requires completed student details (name/phone/address) —
--      it no longer auto-creates a blank student row that the agency then sees
--      as an empty record.

-- 1) Hold expiry -------------------------------------------------------------
alter table bookings add column if not exists expires_at timestamptz;

-- Cancel every unpaid PENDING hold whose expiry has passed. The reserved_seats
-- trigger (0019) frees the seats automatically. SECURITY DEFINER so any
-- signed-in reader (route page / bookings page) can run the sweep; returns the
-- number of holds released.
create or replace function public.expire_stale_holds() returns integer
language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  update bookings set status = 'CANCELLED'
   where status = 'PENDING'
     and coalesce(is_paid, false) = false
     and expires_at is not null
     and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end; $$;
grant execute on function public.expire_stale_holds() to authenticated;

-- 2) One active booking per student per route --------------------------------
-- Cancel older duplicates first (keep the newest) so the index can be built.
with ranked as (
  select id, row_number() over (
           partition by student_id, route_id order by created_at desc) as rn
  from bookings
  where status in ('PENDING','CONFIRMED','WAITLISTED')
)
update bookings b set status = 'CANCELLED'
from ranked r where b.id = r.id and r.rn > 1;

create unique index if not exists uq_bookings_active_student_route
  on bookings (student_id, route_id)
  where status in ('PENDING','CONFIRMED','WAITLISTED');

-- 3) reserve_seat v5 ----------------------------------------------------------
-- Adds on top of 0019: details gate, duplicate gate, expiry stamp on the hold,
-- and restores the student_name/email snapshot from 0008 (0019 dropped it).
create or replace function public.reserve_seat(
  p_route_id uuid, p_pickup_stop_id uuid, p_drop_stop_id uuid
) returns bookings language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_route routes; v_student students; v_alloc seat_allocations;
  v_count int; v_booking bookings; v_status booking_status;
  v_name text; v_phone text; v_email text;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated' using errcode='P0001'; end if;
  select * into v_route from routes where id = p_route_id;
  if v_route.id is null then raise exception 'Route not found' using errcode='P0002'; end if;

  -- Details gate: the details form (name/phone on profiles, address on
  -- students) must be completed before a seat can be reserved.
  select full_name, phone, email into v_name, v_phone, v_email
    from profiles where id = v_uid;
  select * into v_student from students where profile_id = v_uid limit 1;
  if v_student.id is null
     or coalesce(trim(v_name), '') = ''
     or coalesce(trim(v_phone), '') = ''
     or coalesce(trim(v_student.address), '') = '' then
    raise exception 'Please fill in your details (name, phone and address) before reserving a seat'
      using errcode = 'P0006';
  end if;

  -- Free seats whose unpaid hold has lapsed before counting availability.
  perform public.expire_stale_holds();

  -- Duplicate gate: one active booking per student per route.
  if exists (select 1 from bookings
              where student_id = v_student.id and route_id = p_route_id
                and status in ('PENDING','CONFIRMED','WAITLISTED')) then
    raise exception 'You already have an active booking on this route — see My bookings'
      using errcode = 'P0007';
  end if;

  -- Lock the allocation row so concurrent reservations can't overbook.
  select sa.* into v_alloc from seat_allocations sa
    join route_assignments ra on ra.id = sa.route_assignment_id
   where ra.route_id = p_route_id order by sa.created_at limit 1
   for update of sa;
  if v_alloc.id is null then
    raise exception 'No seats configured for this route' using errcode='P0004';
  end if;
  select count(*) into v_count from bookings
   where seat_allocation_id = v_alloc.id and status in ('PENDING','CONFIRMED');
  v_status := case when v_count < v_alloc.total_seats then 'PENDING' else 'WAITLISTED' end;
  begin
    insert into bookings (institution_id, student_id, route_id, pickup_stop_id,
        drop_stop_id, status, seat_allocation_id, student_name, student_email,
        expires_at)
    values (v_route.institution_id, v_student.id, p_route_id, p_pickup_stop_id,
        p_drop_stop_id, v_status, v_alloc.id, v_name, v_email,
        case when v_status = 'PENDING' then now() + interval '30 minutes' end)
    returning * into v_booking; -- trigger updates reserved_seats
  exception when unique_violation then
    -- Race: two tabs reserving at once — the partial unique index wins.
    raise exception 'You already have an active booking on this route — see My bookings'
      using errcode = 'P0007';
  end;
  return v_booking;
end; $$;
grant execute on function public.reserve_seat(uuid, uuid, uuid) to authenticated;

-- 4) pay_booking v3: an expired unpaid hold can no longer be paid; a paid hold
--    never expires (expires_at is cleared on payment).
create or replace function public.pay_booking(p_booking_id uuid)
returns bookings language plpgsql security definer set search_path = public as $$
declare v_student students; v_booking bookings;
begin
  select * into v_student from students where profile_id = auth.uid() limit 1;
  if v_student.id is null then raise exception 'No student record for this account' using errcode='P0001'; end if;
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if v_booking.student_id <> v_student.id then raise exception 'Not your booking' using errcode='P0003'; end if;
  if v_booking.status = 'PENDING'
     and coalesce(v_booking.is_paid, false) = false
     and v_booking.expires_at is not null
     and v_booking.expires_at < now() then
    -- Refuse only — an UPDATE here would be rolled back by this very RAISE.
    -- The expire_stale_holds() sweep (run by every booking page and by
    -- reserve_seat) cancels the lapsed hold and frees the seat.
    raise exception 'Your seat hold expired — please reserve the seat again'
      using errcode = 'P0008';
  end if;
  if v_booking.status not in ('PENDING','CONFIRMED') then
    raise exception 'Only a held seat can be paid for' using errcode='P0005'; end if;
  update bookings set is_paid = true, expires_at = null
   where id = p_booking_id returning * into v_booking;
  return v_booking;
end; $$;
grant execute on function public.pay_booking(uuid) to authenticated;
