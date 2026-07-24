-- 0096_driver_runsheet_pickup_order.sql (idempotent — requires 0069, 0086)
--
-- Driver run-sheet in PICKUP ORDER. Until now `driver_bookings` returned the
-- roster ordered by `created_at desc` (the order riders happened to book), which
-- has nothing to do with the physical route. A driver reading the list top-to-
-- bottom had no idea who to pick up next.
--
-- This redefines `driver_bookings` to:
--   • ORDER BY route, then the rider's pickup-stop sequence (stop 1 → 2 → …),
--     so the list reads as the actual run-sheet in travel order; and
--   • return `route_id`, `pickup_sequence`, and today's `pickup_status`
--     (NEXT / SKIPPED from route_stop_progress, migration 0086) so the panel can
--     number the stops and highlight the one the driver is heading to — lining
--     the roster up with the "Route progress / skip stop" page.
--
-- Return type changes (new OUT columns) → drop before recreate. The idempotent
-- `db:migrate` re-run of the older 0069 definition will raise a benign 42P13
-- (return-type change) that the migrate script already treats as a skip.

drop function if exists public.driver_bookings(int, int);

create or replace function public.driver_bookings(
  p_limit int default null, p_offset int default 0
)
returns table (
  booking_id uuid, status text, created_at timestamptz,
  student_name text, student_phone text,
  bus_number text, route_name text, pickup_name text, college_name text,
  current_stage text,
  route_id uuid, pickup_sequence int, pickup_status text
) language sql stable security definer set search_path = public as $$
  select b.id, b.status::text, b.created_at, pr.full_name, pr.phone,
         v.bus_number, r.name, ps.name, i.name,
         (select re.stage::text from ride_events re
            where re.booking_id = b.id
              and (re.recorded_at at time zone 'Asia/Kolkata')::date
                  = (now() at time zone 'Asia/Kolkata')::date
            order by re.recorded_at desc limit 1),
         r.id,
         ps.sequence,
         rsp.status
  from bookings b
  join routes r on r.id = b.route_id
  join vehicles v on v.id = r.vehicle_id
  left join institutions i on i.id = r.institution_id
  left join route_stops ps on ps.id = b.pickup_stop_id
  left join route_stop_progress rsp
    on rsp.route_id = b.route_id
   and rsp.stop_id = b.pickup_stop_id
   and rsp.service_date = (now() at time zone 'Asia/Kolkata')::date
  left join students s on s.id = b.student_id
  left join profiles pr on pr.id = s.profile_id
  where b.status in ('PENDING', 'CONFIRMED')
    and v.id in (select public.driver_today_vehicle_ids())
  -- Physical run-sheet order: group by route, then walk the stops in sequence;
  -- name + id break ties so pagination stays a stable total order.
  order by r.name nulls last, r.id, ps.sequence nulls last, pr.full_name nulls last, b.id
  limit p_limit offset coalesce(p_offset, 0);
$$;
grant execute on function public.driver_bookings(int, int) to authenticated;
