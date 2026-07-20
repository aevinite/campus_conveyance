-- 0051_agency_bookings_paginate.sql (idempotent — supersedes 0032's agency_bookings)
-- agency_bookings returned EVERY booking for an agency, unpaginated, ordered by
-- created_at — so View/Manage Bookings loaded the whole history (multi-MB payload
-- + thousands of DOM nodes at scale), and Manage fetched all then filtered PENDING
-- in JS.
--
-- Add an optional server-side status filter + LIMIT/OFFSET. The params default so
-- existing callers (the dashboard report, which must aggregate ALL bookings) keep
-- getting the full set: p_status null = all statuses, p_limit null = no limit.
drop function if exists public.agency_bookings(uuid);
create or replace function public.agency_bookings(
  p_agency_id uuid,
  p_status text default null,
  p_limit int default null,
  p_offset int default 0
)
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
    and (p_status is null or b.status::text = p_status)
  order by b.created_at desc
  limit p_limit offset coalesce(p_offset, 0);
$$;
grant execute on function public.agency_bookings(uuid, text, int, int) to authenticated;

-- Total matching rows, for the pagination controls (and the dashboard "pending"
-- tile) — same agency-ownership + status rules as the list above.
create or replace function public.agency_bookings_count(
  p_agency_id uuid, p_status text default null
) returns bigint language sql stable security definer set search_path = public as $$
  select count(*)
  from bookings b
  join routes r on r.id = b.route_id
  where r.agency_id = p_agency_id
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid())
    and (p_status is null or b.status::text = p_status);
$$;
grant execute on function public.agency_bookings_count(uuid, text) to authenticated;
