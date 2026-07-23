-- Indexes for hot lookup paths that currently seq-scan.
--
-- M4: drivers(profile_id) — driver_set_online, driver_update_location (the
--     throttled GPS ping), driver_status, driver_today_vehicle_ids and
--     driver_profile all filter `where profile_id = auth.uid()` on every panel
--     render and location ping.
-- M6: route_assignments(vehicle_id) — sync_vehicle_capacity (0029) seq-scans by
--     vehicle_id on every bus capacity edit.
--
-- (M5 parents(profile_id) is already covered by uq_parents_profile_id from 0074 —
--  a partial unique btree on profile_id serves the `profile_id = auth.uid()`
--  lookups too, so no separate index is added here.)

create index if not exists idx_drivers_profile on drivers(profile_id);
create index if not exists idx_route_assignments_vehicle on route_assignments(vehicle_id);
