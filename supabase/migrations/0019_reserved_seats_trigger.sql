-- 0019_reserved_seats_trigger.sql (idempotent)
-- Make seat_allocations.reserved_seats a TRIGGER-MAINTAINED value equal to the
-- count of active (PENDING/CONFIRMED) bookings, so it can never drift again.
-- Previously it was hand-incremented in reserve_seat and hand-decremented in
-- cancel_booking/reject_booking — any booking removed another way (e.g. a
-- cascade delete when a student/route row was removed) left the counter stale
-- (that's why a route with zero bookings still showed seats "taken").

-- 1) Keep reserved_seats in sync on every booking change.
create or replace function public.sync_reserved_seats() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP <> 'INSERT' and OLD.seat_allocation_id is not null then
    update seat_allocations sa set reserved_seats = (
      select count(*) from bookings b
      where b.seat_allocation_id = OLD.seat_allocation_id
        and b.status in ('PENDING','CONFIRMED'))
     where sa.id = OLD.seat_allocation_id;
  end if;
  if TG_OP <> 'DELETE' and NEW.seat_allocation_id is not null then
    update seat_allocations sa set reserved_seats = (
      select count(*) from bookings b
      where b.seat_allocation_id = NEW.seat_allocation_id
        and b.status in ('PENDING','CONFIRMED'))
     where sa.id = NEW.seat_allocation_id;
  end if;
  return null;
end; $$;

drop trigger if exists trg_sync_reserved_seats on bookings;
create trigger trg_sync_reserved_seats
after insert or update or delete on bookings
for each row execute function public.sync_reserved_seats();

-- 2) reserve_seat: capacity check via a locked count (no manual increment).
create or replace function public.reserve_seat(
  p_route_id uuid, p_pickup_stop_id uuid, p_drop_stop_id uuid
) returns bookings language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_route routes; v_student students; v_alloc seat_allocations;
  v_count int; v_booking bookings; v_status booking_status;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated' using errcode='P0001'; end if;
  select * into v_route from routes where id = p_route_id;
  if v_route.id is null then raise exception 'Route not found' using errcode='P0002'; end if;
  select * into v_student from students where profile_id = v_uid limit 1;
  if v_student.id is null then
    insert into students (profile_id) values (v_uid) returning * into v_student;
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
  insert into bookings (institution_id, student_id, route_id, pickup_stop_id, drop_stop_id, status, seat_allocation_id)
  values (v_route.institution_id, v_student.id, p_route_id, p_pickup_stop_id, p_drop_stop_id, v_status, v_alloc.id)
  returning * into v_booking; -- trigger updates reserved_seats
  return v_booking;
end; $$;
grant execute on function public.reserve_seat(uuid, uuid, uuid) to authenticated;

-- 3) cancel_booking: just flip status (no manual decrement).
create or replace function public.cancel_booking(p_booking_id uuid)
returns bookings language plpgsql security definer set search_path = public as $$
declare v_student students; v_booking bookings;
begin
  select * into v_student from students where profile_id = auth.uid() limit 1;
  if v_student.id is null then raise exception 'No student record for this account' using errcode='P0001'; end if;
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if v_booking.student_id <> v_student.id then raise exception 'Not your booking' using errcode='P0003'; end if;
  if v_booking.status = 'CANCELLED' then return v_booking; end if;
  update bookings set status='CANCELLED' where id = p_booking_id returning * into v_booking;
  return v_booking; -- trigger updates reserved_seats
end; $$;
grant execute on function public.cancel_booking(uuid) to authenticated;

-- 4) reject_booking: just flip status (no manual decrement).
create or replace function public.reject_booking(p_booking_id uuid) returns bookings
language plpgsql security definer set search_path = public as $$
declare v bookings;
begin
  if not public.agency_owns_booking(p_booking_id) then
    raise exception 'Not your booking' using errcode='P0003'; end if;
  update bookings set status='CANCELLED'
    where id=p_booking_id and status in ('PENDING','CONFIRMED') returning * into v;
  if v.id is null then raise exception 'Cannot reject' using errcode='P0005'; end if;
  return v; -- trigger updates reserved_seats
end; $$;

-- 5) One-time reconcile of the existing drift.
update seat_allocations sa set reserved_seats = (
  select count(*) from bookings b
  where b.seat_allocation_id = sa.id and b.status in ('PENDING','CONFIRMED'));
