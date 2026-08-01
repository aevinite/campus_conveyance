-- 0113_agency_refunds.sql (idempotent — requires 0112_cancellation_refunds)
--
-- The admin already sees + processes refund requests (/aevinite/payments/refunds).
-- Surface the SAME cancellation/refund info to the AGENCY that runs the route, so
-- both panels show it — read-only (the platform holds the money and issues the
-- refund, so only the admin acts). Security-definer + owner check because
-- payments are RLS-locked away from the agency session.

create or replace function public.agency_refunds(
  p_agency_id uuid, p_limit int default null, p_offset int default 0
) returns table (
  booking_id uuid, student_name text, student_email text, route_name text,
  amount_cents bigint, refund_status text, refund_amount_cents bigint,
  refund_details jsonb, cancel_reason text, requested_at timestamptz, refunded_at timestamptz
) language sql stable security definer set search_path = public as $$
  select b.id, b.student_name, b.student_email, r.name,
         p.amount_cents, p.refund_status, p.refund_amount_cents,
         b.refund_details, b.cancel_reason, p.updated_at, p.refunded_at
  from payments p
  join bookings b on b.id = p.booking_id
  join routes r on r.id = b.route_id
  where r.agency_id = p_agency_id
    and p.refund_status in ('REQUESTED', 'PROCESSED', 'DECLINED')
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid())
  -- Still-pending refunds first, then most recent.
  order by (p.refund_status = 'REQUESTED') desc, p.updated_at desc
  limit p_limit offset coalesce(p_offset, 0);
$$;
grant execute on function public.agency_refunds(uuid, int, int) to authenticated;

create or replace function public.agency_refunds_count(p_agency_id uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select count(*)
  from payments p
  join bookings b on b.id = p.booking_id
  join routes r on r.id = b.route_id
  where r.agency_id = p_agency_id
    and p.refund_status in ('REQUESTED', 'PROCESSED', 'DECLINED')
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid());
$$;
grant execute on function public.agency_refunds_count(uuid) to authenticated;
