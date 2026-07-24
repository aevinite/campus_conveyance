-- 0098_ride_history.sql (idempotent — requires 0001/0043/0090)
--
-- Family-facing trip history. ride_events (0043) are written by drivers but were
-- only readable by the admin ops console. This adds ONE security-definer RPC that
-- returns a rider's bookings (their own, as a student; their linked children's,
-- as a parent) with the receipt fields + the per-booking ride-event timeline
-- (boarded → reached → got-off, most-recent first) as jsonb.
--
-- Read-only; no new tables. Caller is re-derived from auth.uid() (never trusted
-- input), so a student sees only their rides and a parent only their children's.

create or replace function public.my_ride_history()
returns table (
  booking_id     uuid,
  status         text,
  student_name   text,
  route_name     text,
  college_name   text,
  bus_number     text,
  agency_name    text,
  pickup_name    text,
  billing_period text,
  price_cents            int,
  price_monthly_cents    int,
  price_semester_cents   int,
  price_yearly_cents     int,
  paid_at        timestamptz,
  created_at     timestamptz,
  events         jsonb
) language sql stable security definer set search_path = public as $$
  select
    b.id, b.status::text, b.student_name,
    r.name, i.name, v.bus_number, ag.name, ps.name,
    b.billing_period::text,
    r.price_cents, r.price_monthly_cents, r.price_semester_cents, r.price_yearly_cents,
    b.paid_at, b.created_at,
    coalesce((
      select jsonb_agg(jsonb_build_object('stage', re.stage, 'at', re.recorded_at)
                       order by re.recorded_at desc)
      from ride_events re where re.booking_id = b.id
    ), '[]'::jsonb)
  from bookings b
  join routes r on r.id = b.route_id
  left join institutions i on i.id = r.institution_id
  left join vehicles v on v.id = r.vehicle_id
  left join agencies ag on ag.id = r.agency_id
  left join route_stops ps on ps.id = b.pickup_stop_id
  where b.status in ('CONFIRMED', 'CANCELLED')
    and (
      -- the caller's own rides (as a student) …
      b.student_id in (select s.id from students s where s.profile_id = auth.uid())
      -- … or their linked children's rides (as a parent).
      or b.student_id in (
        select ps2.student_id from parent_students ps2
        join parents pa on pa.id = ps2.parent_id
        where pa.profile_id = auth.uid()
      )
    )
  order by b.created_at desc;
$$;
grant execute on function public.my_ride_history() to authenticated;
