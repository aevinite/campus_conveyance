-- 0061_retention_indexes_and_driver_buses.sql (idempotent)
--
-- (1) RETENTION. ride_events and notifications are append-only and grow forever;
-- parent_link_codes was pruned only when a student minted a NEW code (a student
-- who never mints again leaks rows). Only rate_limit_events + hold expiry had
-- cron. Add a daily sweep. A SECURITY DEFINER function (owns the deletes) is
-- scheduled instead of inline SQL so the cron entry stays one clean call.
create or replace function public.retention_cleanup() returns void
language sql security definer set search_path = public as $$
  -- Journey history: 90 days is well past any "recent trips" view.
  delete from ride_events where created_at < now() - interval '90 days';
  -- Notifications: drop read ones after 30 days and everything after 90
  -- (my_notifications only ever shows the latest 50 anyway).
  delete from notifications
    where created_at < now() - interval '90 days'
       or (is_read = true and created_at < now() - interval '30 days');
  -- Link codes are single-use / 3-min TTL; keep a day for audit then drop.
  delete from parent_link_codes where expires_at < now() - interval '1 day';
$$;
-- Not granted to clients — maintenance only. cron.schedule upserts by name.
select cron.schedule('data-retention-cleanup', '20 3 * * *', $$ select public.retention_cleanup(); $$);

-- (2) Index the created_at-desc sort behind the paginated booking lists (agency
-- Manage/View Bookings, student My Bookings) so deep OFFSET pages don't do a
-- full scan + sort. Plain index serves the ORDER BY; the composite serves the
-- student list, whose RLS filters by student_id first.
create index if not exists idx_bookings_created_at on bookings (created_at desc);
create index if not exists idx_bookings_student_created on bookings (student_id, created_at desc);

-- (3) parent_students PK is (parent_id, student_id), so lookups BY student_id
-- alone (notification fan-out in driver_mark_stage, and the parent-eligibility
-- EXISTS inside bus_live_location — on the 12s live-map poll) had no index.
create index if not exists idx_parent_students_student on parent_students (student_id);

-- (4) Back driver_today_vehicle_ids()'s substitute lookup (evaluated once per
-- driver_buses / driver_bookings call, i.e. twice per dashboard render).
create index if not exists idx_bus_driver_changes_driver
  on bus_driver_changes (driver_id, effective_date);

-- (5) driver_buses() joined vehicles → routes, emitting one row PER route. A bus
-- assigned to two routes therefore appeared twice: it double-counted "Buses
-- assigned" on the dashboard and produced duplicate React keys in the list.
-- Collapse to one row per vehicle (its earliest-departing route as the shown
-- one); riders across all its routes still surface via driver_bookings().
create or replace function public.driver_buses()
returns table (
  vehicle_id uuid, bus_number text, registration_no text, is_ac boolean, capacity int,
  bus_model text, bus_color text, image_url text,
  route_id uuid, route_name text, departure_time time, price_cents bigint,
  college_name text, stops_count bigint, seats_total int, seats_reserved int
) language sql stable security definer set search_path = public as $$
  select * from (
    select distinct on (v.id)
           v.id as vehicle_id, v.bus_number, v.registration_no, v.is_ac, v.capacity,
           v.bus_model, v.bus_color, v.image_url,
           r.id as route_id, r.name as route_name, r.departure_time, r.price_cents,
           i.name as college_name,
           (select count(*) from route_stops rs where rs.route_id = r.id) as stops_count,
           (select sa.total_seats from seat_allocations sa
              join route_assignments ra on ra.id = sa.route_assignment_id
              where ra.route_id = r.id limit 1) as seats_total,
           (select sa.reserved_seats from seat_allocations sa
              join route_assignments ra on ra.id = sa.route_assignment_id
              where ra.route_id = r.id limit 1) as seats_reserved
    from vehicles v
    left join routes r on r.vehicle_id = v.id
    left join institutions i on i.id = r.institution_id
    where v.id in (select public.driver_today_vehicle_ids())
    order by v.id, r.departure_time nulls last
  ) t
  order by bus_number nulls last;
$$;
grant execute on function public.driver_buses() to authenticated;
