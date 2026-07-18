-- 0023_agency_confirms_booking.sql (idempotent)
-- The agency must accept a booking before the seat is confirmed. Payment now only
-- marks the booking PAID and leaves it PENDING; the agency's confirm sets it
-- CONFIRMED. Also expose is_paid to the agency booking list.
alter table bookings add column if not exists is_paid boolean not null default false;

-- pay_booking: mark the caller's held (PENDING) booking as paid — do NOT confirm.
create or replace function public.pay_booking(p_booking_id uuid)
returns bookings language plpgsql security definer set search_path = public as $$
declare v_student students; v_booking bookings;
begin
  select * into v_student from students where profile_id = auth.uid() limit 1;
  if v_student.id is null then raise exception 'No student record for this account' using errcode='P0001'; end if;
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if v_booking.student_id <> v_student.id then raise exception 'Not your booking' using errcode='P0003'; end if;
  if v_booking.status not in ('PENDING','CONFIRMED') then
    raise exception 'Only a held seat can be paid for' using errcode='P0005'; end if;
  update bookings set is_paid = true where id = p_booking_id returning * into v_booking;
  return v_booking;
end; $$;
grant execute on function public.pay_booking(uuid) to authenticated;

-- agency_bookings: add is_paid (drop + recreate — return type changes).
drop function if exists public.agency_bookings(uuid);
create or replace function public.agency_bookings(p_agency_id uuid)
returns table (
  booking_id uuid, status text, created_at timestamptz, is_paid boolean,
  student_name text, student_email text, student_phone text,
  student_address text, student_grade text, guardian_name text, guardian_phone text,
  route_name text, bus_number text, bus_registration text,
  pickup_name text, drop_name text, price_cents bigint
) language sql stable security definer set search_path = public as $$
  select b.id, b.status::text, b.created_at, b.is_paid,
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
