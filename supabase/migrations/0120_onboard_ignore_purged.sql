-- 0120_onboard_ignore_purged.sql (idempotent — requires 0059, 0111)
--
-- Fix (MED): a PURGED student who books again became invisible AND unmanageable.
-- `agency_onboard_bookings/_count` (0059) excluded students in
-- agency_hidden_students regardless of `purged_at`, while the Deleted-Students
-- RPCs (0111) skip `purged_at IS NOT NULL`. So after a purge, a student's NEW
-- confirmed booking was hidden from Manage Students AND absent from Deleted
-- Students, yet still consumed a seat — with no way for the agency to see or act
-- on it.
--
-- Fix: only exclude NON-purged hidden rows (`h.purged_at is null`). A regular
-- (non-purged) hidden student stays hidden; a purged student reappears in Manage
-- Students the moment they have an active booking again — where the agency can
-- manage them (and re-remove, which 0119's action resets purged_at). Purge still
-- means "gone from my lists" for a student with no current booking.

create or replace function public.agency_onboard_bookings(
  p_agency_id uuid,
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
    and b.status::text = 'CONFIRMED'
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid())
    and not exists (
      select 1 from agency_hidden_students h
      where h.agency_id = p_agency_id and h.student_id = b.student_id
        and h.purged_at is null
    )
  order by b.created_at desc
  limit p_limit offset coalesce(p_offset, 0);
$$;
grant execute on function public.agency_onboard_bookings(uuid, int, int) to authenticated;

create or replace function public.agency_onboard_count(p_agency_id uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select count(*)
  from bookings b
  join routes r on r.id = b.route_id
  where r.agency_id = p_agency_id
    and b.status::text = 'CONFIRMED'
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid())
    and not exists (
      select 1 from agency_hidden_students h
      where h.agency_id = p_agency_id and h.student_id = b.student_id
        and h.purged_at is null
    );
$$;
grant execute on function public.agency_onboard_count(uuid) to authenticated;
