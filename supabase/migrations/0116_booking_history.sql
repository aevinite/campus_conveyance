-- 0116_booking_history.sql (idempotent — requires 0001/0103/0107/0112)
--
-- The rider- and parent-facing History should be a BOOKING history, not the
-- boarding log (my_ride_history, 0100) it used to show. Product decision
-- 2026-08-03:
--   * Show CONFIRMED bookings — payment done, this bus + route is confirmed.
--   * Show CANCELLED bookings ONLY when the rider had actually PAID before
--     cancelling (a verified payment reached PAID/REFUNDED, or a refund was
--     opened). A hold that lapsed or was cancelled before paying NEVER appears.
--   * Everything else (unpaid / expired / rejected / waitlisted) is excluded.
--
-- Read-only + security-definer, re-derived from auth.uid(): the caller's own
-- bookings (as a student) or their linked children's (as a parent) — same
-- authorization shape as my_ride_history. The cancelled rows carry the payment's
-- refund_status so the UI can show "Refund requested / processed / declined".

drop function if exists public.my_booking_history();

create or replace function public.my_booking_history()
returns table (
  booking_id     uuid,
  student_name   text,
  route_name     text,
  college_name   text,
  bus_number     text,
  agency_name    text,
  pickup_name    text,
  status         text,
  refund_status  text,
  amount_cents   bigint,
  billing_period text,
  booked_at      timestamptz,
  paid_at        timestamptz,
  changed_at     timestamptz
) language sql stable security definer set search_path = public as $$
  with mine as (
    -- The caller's own bookings (student) or their linked children's (parent).
    select b.*
    from bookings b
    where b.student_id in (select s.id from students s where s.profile_id = auth.uid())
       or b.student_id in (
         select ps.student_id from parent_students ps
         join parents pa on pa.id = ps.parent_id
         where pa.profile_id = auth.uid()
       )
  ),
  pay as (
    -- One payment summary per booking: was it EVER really paid, its latest
    -- refund state, and the amount.
    select p.booking_id,
           bool_or(p.status in ('PAID','REFUNDED') or p.refund_status <> 'NONE') as was_paid,
           max(p.amount_cents) as amount_cents,
           (array_agg(p.refund_status order by p.updated_at desc nulls last))[1] as refund_status
    from payments p
    group by p.booking_id
  )
  select
    m.id,
    m.student_name,
    r.name,
    i.name,
    v.bus_number,
    ag.name,
    ps.name,
    m.status::text,
    coalesce(pay.refund_status, 'NONE'),
    coalesce(pay.amount_cents, 0)::bigint,
    m.billing_period::text,
    m.created_at,
    m.paid_at,
    m.updated_at
  from mine m
  join routes r on r.id = m.route_id
  left join pay on pay.booking_id = m.id
  left join institutions i on i.id = r.institution_id
  left join vehicles v on v.id = r.vehicle_id
  left join agencies ag on ag.id = r.agency_id
  left join route_stops ps on ps.id = m.pickup_stop_id
  where m.status = 'CONFIRMED'
     or (m.status = 'CANCELLED' and (coalesce(pay.was_paid, false) or m.is_paid))
  order by coalesce(m.paid_at, m.updated_at, m.created_at) desc;
$$;
grant execute on function public.my_booking_history() to authenticated;
