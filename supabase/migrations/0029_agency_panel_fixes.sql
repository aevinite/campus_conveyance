-- 0029_agency_panel_fixes.sql (idempotent — requires 0028 for the REJECTED status)
-- Agency-panel fixes:
--   1) reject_booking marks the booking REJECTED (distinct from a student's
--      CANCELLED), so the dashboard's Rejected count/chart is real.
--   2) confirm_booking / reject_booking raise clear, user-readable errors when
--      the booking changed underneath the agency (e.g. the student cancelled
--      at the same moment) instead of an opaque failure.
--   3) confirm_booking refuses bookings the student has not paid for.
--   4) Editing a bus's seat capacity now updates the seat allocations of its
--      existing routes (they used to keep the capacity from route creation).
--   5) pay_booking records an actual payments row + bookings.paid_at, so
--      revenue/payment reporting is backed by real payment records.

-- When was the booking paid — the basis for time-bucketed revenue.
alter table bookings add column if not exists paid_at timestamptz;
-- Guard for pay_booking below (normally created by 0025_student_booking_guards).
alter table bookings add column if not exists expires_at timestamptz;

-- 2+3) Confirm: only a PAID, still-PENDING booking can be confirmed.
create or replace function public.confirm_booking(p_booking_id uuid) returns bookings
language plpgsql security definer set search_path = public as $$
declare v bookings;
begin
  if not public.agency_owns_booking(p_booking_id) then
    raise exception 'Not your booking' using errcode='P0003'; end if;
  select * into v from bookings where id = p_booking_id;
  if v.id is null then
    raise exception 'This booking no longer exists — refresh the list.' using errcode='P0002'; end if;
  if v.status <> 'PENDING' then
    raise exception 'This booking is no longer pending (the student may have just cancelled it) — refresh the list.' using errcode='P0005'; end if;
  if not v.is_paid then
    raise exception 'The student has not paid for this booking yet — it can be confirmed only after payment.' using errcode='P0006'; end if;
  update bookings set status='CONFIRMED'
    where id = p_booking_id and status = 'PENDING' and is_paid
  returning * into v;
  if v.id is null then
    raise exception 'This booking just changed — refresh the list and try again.' using errcode='P0005'; end if;
  return v;
end; $$;

-- 1+2) Reject: terminal REJECTED status; seat freed by the reserved-seats trigger.
create or replace function public.reject_booking(p_booking_id uuid) returns bookings
language plpgsql security definer set search_path = public as $$
declare v bookings;
begin
  if not public.agency_owns_booking(p_booking_id) then
    raise exception 'Not your booking' using errcode='P0003'; end if;
  update bookings set status='REJECTED'
    where id = p_booking_id and status in ('PENDING','CONFIRMED') returning * into v;
  if v.id is null then
    raise exception 'This booking is no longer active (the student may have just cancelled it) — refresh the list.' using errcode='P0005'; end if;
  return v; -- trigger updates reserved_seats (REJECTED is not an active status)
end; $$;

-- A student can't flip an agency rejection into a cancellation — REJECTED is terminal.
create or replace function public.cancel_booking(p_booking_id uuid)
returns bookings language plpgsql security definer set search_path = public as $$
declare v_student students; v_booking bookings;
begin
  select * into v_student from students where profile_id = auth.uid() limit 1;
  if v_student.id is null then raise exception 'No student record for this account' using errcode='P0001'; end if;
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if v_booking.student_id <> v_student.id then raise exception 'Not your booking' using errcode='P0003'; end if;
  if v_booking.status in ('CANCELLED','REJECTED') then return v_booking; end if;
  update bookings set status='CANCELLED' where id = p_booking_id returning * into v_booking;
  return v_booking; -- trigger updates reserved_seats
end; $$;

-- 4) Capacity edits propagate to every seat allocation of the bus's routes.
create or replace function public.sync_vehicle_capacity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update seat_allocations sa
     set total_seats = NEW.capacity
    from route_assignments ra
   where ra.id = sa.route_assignment_id
     and ra.vehicle_id = NEW.id;
  return null;
end; $$;

drop trigger if exists trg_sync_vehicle_capacity on vehicles;
create trigger trg_sync_vehicle_capacity
after update of capacity on vehicles
for each row when (OLD.capacity is distinct from NEW.capacity)
execute function public.sync_vehicle_capacity();

-- One-time reconcile of allocations that drifted before this trigger existed.
update seat_allocations sa
   set total_seats = v.capacity
  from route_assignments ra
  join vehicles v on v.id = ra.vehicle_id
 where ra.id = sa.route_assignment_id
   and sa.total_seats is distinct from v.capacity;

-- 5) pay_booking v4: keeps the 0025 hold-expiry rules, and now records the
--    payment (payments row + paid_at). Idempotent per booking (no double charge).
create or replace function public.pay_booking(p_booking_id uuid)
returns bookings language plpgsql security definer set search_path = public as $$
declare v_student students; v_booking bookings; v_price bigint;
begin
  select * into v_student from students where profile_id = auth.uid() limit 1;
  if v_student.id is null then raise exception 'No student record for this account' using errcode='P0001'; end if;
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if v_booking.student_id <> v_student.id then raise exception 'Not your booking' using errcode='P0003'; end if;
  if v_booking.is_paid then return v_booking; end if; -- already paid: no double charge
  if v_booking.status = 'PENDING'
     and v_booking.expires_at is not null
     and v_booking.expires_at < now() then
    -- Refuse only — an UPDATE here would be rolled back by this very RAISE.
    -- The expire_stale_holds() sweep (0025) cancels the lapsed hold.
    raise exception 'Your seat hold expired — please reserve the seat again'
      using errcode = 'P0008';
  end if;
  if v_booking.status not in ('PENDING','CONFIRMED') then
    raise exception 'Only a held seat can be paid for' using errcode='P0005'; end if;
  select price_cents into v_price from routes where id = v_booking.route_id;
  update bookings set is_paid = true, paid_at = now(), expires_at = null
   where id = p_booking_id returning * into v_booking;
  insert into payments (institution_id, booking_id, amount_cents, currency, status)
  values (v_booking.institution_id, v_booking.id, coalesce(v_price, 0), 'INR', 'PAID');
  return v_booking;
end; $$;
grant execute on function public.pay_booking(uuid) to authenticated;

-- Backfill: bookings already marked paid get a payments row + approximate paid_at,
-- so existing data shows up in the new payment-backed reports.
insert into payments (institution_id, booking_id, amount_cents, currency, status, created_at)
select b.institution_id, b.id, coalesce(r.price_cents, 0), 'INR', 'PAID', b.created_at
  from bookings b
  join routes r on r.id = b.route_id
 where b.is_paid
   and not exists (select 1 from payments p where p.booking_id = b.id);
update bookings set paid_at = created_at where is_paid and paid_at is null;

-- agency_bookings: expose paid_at (drop + recreate — return type changes).
drop function if exists public.agency_bookings(uuid);
create or replace function public.agency_bookings(p_agency_id uuid)
returns table (
  booking_id uuid, status text, created_at timestamptz, is_paid boolean, paid_at timestamptz,
  student_name text, student_email text, student_phone text,
  student_address text, student_grade text, guardian_name text, guardian_phone text,
  route_name text, bus_number text, bus_registration text,
  pickup_name text, drop_name text, price_cents bigint
) language sql stable security definer set search_path = public as $$
  select b.id, b.status::text, b.created_at, b.is_paid, b.paid_at,
         pr.full_name, pr.email, pr.phone,
         s.address, s.grade, s.guardian_name, s.guardian_phone,
         coalesce(r.name, r.start_location),
         v.bus_number, v.registration_no,
         ps.name, i.name, r.price_cents
  from bookings b
  join routes r on r.id = b.route_id
  left join institutions i on i.id = r.institution_id
  left join vehicles v on v.id = r.vehicle_id
  left join route_stops ps on ps.id = b.pickup_stop_id
  left join students s on s.id = b.student_id
  left join profiles pr on pr.id = s.profile_id
  where r.agency_id = p_agency_id
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid())
  order by b.created_at desc;
$$;
grant execute on function public.agency_bookings(uuid) to authenticated;
