-- Index the ON DELETE CASCADE / SET NULL foreign keys that currently seq-scan
-- when a profile, institution, driver or stop is hard-deleted. Prod mostly
-- soft-deletes, so these only bite on a true DELETE.
--
-- Only the SMALLER tables are indexed here (plain CREATE INDEX — brief lock). The
-- large / hot tables (audit_logs, notifications, gps_tracking, bookings) are in
-- 0083, built CONCURRENTLY out-of-band so a plain build can't write-lock those
-- hot paths.

-- profile-referencing FKs (a hard auth-user delete cascades/nulls these)
create index if not exists idx_institution_admins_profile on institution_admins(profile_id);
create index if not exists idx_complaints_raised_by on complaints(raised_by);
create index if not exists idx_ride_events_recorded_by on ride_events(recorded_by);

-- institution-referencing FKs (a hard institution delete cascades these)
create index if not exists idx_attendance_institution on attendance(institution_id);
create index if not exists idx_route_assignments_institution on route_assignments(institution_id);
create index if not exists idx_seat_allocations_institution on seat_allocations(institution_id);
create index if not exists idx_parents_institution on parents(institution_id);
create index if not exists idx_complaints_institution on complaints(institution_id);
create index if not exists idx_subscriptions_institution on subscriptions(institution_id);
create index if not exists idx_agency_service_requests_institution on agency_service_requests(institution_id);

-- other unindexed FKs
create index if not exists idx_route_assignments_driver on route_assignments(driver_id);
create index if not exists idx_bus_driver_changes_agency on bus_driver_changes(agency_id);
