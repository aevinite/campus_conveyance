-- Index the ON DELETE CASCADE / SET NULL foreign keys that currently seq-scan
-- when a profile, institution, driver or stop is hard-deleted. Prod mostly
-- soft-deletes, so these only bite on a true DELETE.
--
-- SURVIVING tables only — the six dropped tables (institution_admins, attendance,
-- gps_tracking, complaints, subscriptions, settings; see 0085) are NOT indexed
-- here: CREATE INDEX IF NOT EXISTS raises 42P01 on a missing table and rolls back
-- the whole file, which would prevent the indexes below from landing on a replay
-- or fresh DB. The large / hot tables (audit_logs, notifications, bookings) are
-- in 0083, built CONCURRENTLY out-of-band.

-- profile-referencing FKs (a hard auth-user delete cascades/nulls these)
create index if not exists idx_ride_events_recorded_by on ride_events(recorded_by);

-- institution-referencing FKs (a hard institution delete cascades these)
create index if not exists idx_route_assignments_institution on route_assignments(institution_id);
create index if not exists idx_seat_allocations_institution on seat_allocations(institution_id);
create index if not exists idx_parents_institution on parents(institution_id);
create index if not exists idx_route_stops_institution on route_stops(institution_id);
create index if not exists idx_agency_service_requests_institution on agency_service_requests(institution_id);

-- other unindexed FKs
create index if not exists idx_route_assignments_driver on route_assignments(driver_id);
create index if not exists idx_bus_driver_changes_agency on bus_driver_changes(agency_id);
