-- 0118_driver_runsheet_managed_children.sql (idempotent — requires 0096, 0103)
--
-- Fix: the driver run-sheet showed "—" for the name and phone of parent-managed
-- children. `driver_bookings` (0096) read the rider's name/phone only from the
-- joined profile (`pr.full_name` / `pr.phone`). Parent-managed children (0103)
-- have `profile_id IS NULL` and carry their name/phone on `students` (and the
-- booking's `student_name` snapshot), so those riders appeared unidentifiable on
-- `/driver/riders` — the driver couldn't see who they were or call them.
--
-- This redefines `driver_bookings` to coalesce the rider's name/phone across the
-- profile → students → booking snapshot, matching every other rider-facing RPC
-- (0103, 0117). Same return signature as 0096, so `create or replace` is enough.

-- Drop a dead no-arg overload left over from an early migration (the app only
-- ever calls the (p_limit, p_offset) form). Harmless if it doesn't exist.
drop function if exists public.driver_bookings();

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
  select b.id, b.status::text, b.created_at,
         coalesce(pr.full_name, s.full_name, b.student_name),
         coalesce(pr.phone, s.phone),
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
  order by r.name nulls last, r.id, ps.sequence nulls last,
           coalesce(pr.full_name, s.full_name, b.student_name) nulls last, b.id
  limit p_limit offset coalesce(p_offset, 0);
$$;
grant execute on function public.driver_bookings(int, int) to authenticated;
