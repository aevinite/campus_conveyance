-- 0032_approval_then_payment.sql (idempotent)
-- New booking lifecycle (approval FIRST, payment after):
--   1. Student reserves            → PENDING, approved_at NULL   (waiting for agency approval)
--   2. Agency approves the request → approved_at set, expires_at = now() + 20 min
--   3. Student pays in the window  → payment CONFIRMS the seat (status CONFIRMED)
--   4. Window lapses unpaid        → expire_stale_holds() cancels (payment not received in time)
-- Replaces the old pay-first flow (0023/0029) where payment preceded approval.

alter table bookings add column if not exists approved_at timestamptz;

-- reserve_seat v6: same guards as v5 (details gate P0006, duplicate gate P0007)
-- but NO expiry stamp — the 20-minute payment clock starts at agency approval.
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

  perform public.expire_stale_holds();

  if exists (select 1 from bookings
              where student_id = v_student.id and route_id = p_route_id
                and status in ('PENDING','CONFIRMED','WAITLISTED')) then
    raise exception 'You already have an active booking on this route — see My bookings'
      using errcode = 'P0007';
  end if;

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
        drop_stop_id, status, seat_allocation_id, student_name, student_email)
    values (v_route.institution_id, v_student.id, p_route_id, p_pickup_stop_id,
        p_drop_stop_id, v_status, v_alloc.id, v_name, v_email)
    returning * into v_booking; -- trigger updates reserved_seats
  exception when unique_violation then
    raise exception 'You already have an active booking on this route — see My bookings'
      using errcode = 'P0007';
  end;
  return v_booking;
end; $$;
grant execute on function public.reserve_seat(uuid, uuid, uuid) to authenticated;

-- confirm_booking v3 = APPROVE: works on an UNPAID pending request; stamps the
-- approval + 20-minute payment deadline. Legacy in-flight bookings that already
-- paid under the old flow are confirmed directly.
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
  if v.is_paid then
    -- Old pay-first flow: money already received, approval = confirmation.
    update bookings set status='CONFIRMED', approved_at = coalesce(approved_at, now())
      where id = p_booking_id and status = 'PENDING' returning * into v;
  elsif v.approved_at is not null then
    raise exception 'Already approved — waiting for the student to pay.' using errcode='P0006';
  else
    update bookings set approved_at = now(), expires_at = now() + interval '20 minutes'
      where id = p_booking_id and status = 'PENDING' and approved_at is null
    returning * into v;
  end if;
  if v.id is null then
    raise exception 'This booking just changed — refresh the list and try again.' using errcode='P0005'; end if;
  return v;
end; $$;
grant execute on function public.confirm_booking(uuid) to authenticated;

-- pay_booking v5: only an APPROVED, unexpired request can be paid — and paying
-- CONFIRMS the seat (still records the payments row + paid_at from 0029).
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
  if v_booking.status <> 'PENDING' then
    raise exception 'Only a held seat can be paid for' using errcode='P0005'; end if;
  if v_booking.approved_at is null then
    raise exception 'Waiting for agency approval — you can pay as soon as the agency approves your request.'
      using errcode = 'P0009';
  end if;
  if v_booking.expires_at is not null and v_booking.expires_at < now() then
    -- Refuse only — an UPDATE here would be rolled back by this very RAISE;
    -- the expire_stale_holds() sweep cancels the lapsed booking.
    raise exception 'Your payment window expired — please reserve the seat again'
      using errcode = 'P0008';
  end if;
  select price_cents into v_price from routes where id = v_booking.route_id;
  update bookings set is_paid = true, paid_at = now(), expires_at = null, status = 'CONFIRMED'
   where id = p_booking_id returning * into v_booking;
  insert into payments (institution_id, booking_id, amount_cents, currency, status)
  values (v_booking.institution_id, v_booking.id, coalesce(v_price, 0), 'INR', 'PAID');
  return v_booking;
end; $$;
grant execute on function public.pay_booking(uuid) to authenticated;

-- Backfill: unapproved unpaid requests still carrying the old 30-min reserve
-- expiry must not auto-cancel while they wait for the agency.
update bookings set expires_at = null
 where status = 'PENDING' and coalesce(is_paid, false) = false
   and approved_at is null and expires_at is not null;

-- agency_bookings: expose approved_at + the payment deadline (drop + recreate —
-- return type changes).
drop function if exists public.agency_bookings(uuid);
create or replace function public.agency_bookings(p_agency_id uuid)
returns table (
  booking_id uuid, student_id uuid, status text, created_at timestamptz,
  is_paid boolean, paid_at timestamptz, approved_at timestamptz, payment_due timestamptz,
  student_name text, student_email text, student_phone text,
  student_address text, student_grade text, guardian_name text, guardian_phone text,
  route_name text, bus_number text, bus_registration text,
  pickup_name text, drop_name text, price_cents bigint
) language sql stable security definer set search_path = public as $$
  select b.id, s.id, b.status::text, b.created_at,
         b.is_paid, b.paid_at, b.approved_at, b.expires_at,
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
