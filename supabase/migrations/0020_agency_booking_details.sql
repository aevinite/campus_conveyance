-- 0020_agency_booking_details.sql (idempotent)
-- Agencies should see every detail a student entered while booking: personal
-- details (address, class, guardian) plus exactly which bus / route / pickup
-- stop they chose. Rebuild agency_bookings with the full set (return type
-- changes, so drop + recreate).
drop function if exists public.agency_bookings(uuid);

create or replace function public.agency_bookings(p_agency_id uuid)
returns table (
  booking_id uuid,
  status text,
  created_at timestamptz,
  student_name text,
  student_email text,
  student_phone text,
  student_address text,
  student_grade text,
  guardian_name text,
  guardian_phone text,
  route_name text,
  bus_number text,
  bus_registration text,
  pickup_name text,
  drop_name text,
  price_cents bigint
) language sql stable security definer set search_path = public as $$
  select b.id, b.status::text, b.created_at,
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
