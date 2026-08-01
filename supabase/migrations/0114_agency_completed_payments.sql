-- 0114_agency_completed_payments.sql (idempotent — requires 0107_upi_payments)
--
-- The admin sees completed payments at /aevinite/payments/history. Give the
-- AGENCY the same visibility for ITS OWN routes, so it knows which student has
-- fully paid. Security-definer + owner check because payments are RLS-locked
-- from the agency session. Read-only; only PAID (completed) payments.

create or replace function public.agency_completed_payments(
  p_agency_id uuid, p_limit int default null, p_offset int default 0
) returns table (
  booking_id uuid, student_name text, student_email text, route_name text,
  amount_cents bigint, upi_utr text, reference text,
  submitted_at timestamptz, verified_at timestamptz
) language sql stable security definer set search_path = public as $$
  select b.id, b.student_name, b.student_email, r.name,
         p.amount_cents, p.upi_utr, p.reference, p.submitted_at, p.verified_at
  from payments p
  join bookings b on b.id = p.booking_id
  join routes r on r.id = b.route_id
  where r.agency_id = p_agency_id
    and p.status = 'PAID'
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid())
  order by coalesce(p.verified_at, p.submitted_at, p.created_at) desc
  limit p_limit offset coalesce(p_offset, 0);
$$;
grant execute on function public.agency_completed_payments(uuid, int, int) to authenticated;

create or replace function public.agency_completed_payments_count(p_agency_id uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select count(*)
  from payments p
  join bookings b on b.id = p.booking_id
  join routes r on r.id = b.route_id
  where r.agency_id = p_agency_id
    and p.status = 'PAID'
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid());
$$;
grant execute on function public.agency_completed_payments_count(uuid) to authenticated;
