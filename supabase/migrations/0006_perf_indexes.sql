-- 0006_perf_indexes.sql — indexes on hot filter/join columns (idempotent)
--
-- Postgres does NOT auto-create indexes for foreign keys. The marketplace and
-- panel migrations (0004/0005) added agency_id / owner_profile_id / service
-- columns that every agency-panel and student-catalog query filters or joins
-- on, but left them unindexed — so those queries do sequential scans that get
-- slower as data grows. These indexes turn them into index lookups.

-- agencies — getMyAgency() runs on every agency page; RLS subqueries filter
-- owner_profile_id + status across many policies.
create index if not exists idx_agencies_owner on agencies(owner_profile_id);
create index if not exists idx_agencies_status on agencies(status);

-- agency_services — listMyServices / getCounts (agency_id) and the
-- institutions(name) join (institution_id).
create index if not exists idx_agency_services_agency on agency_services(agency_id);
create index if not exists idx_agency_services_institution on agency_services(institution_id);

-- vehicles — listMyBuses / getCounts (agency_id) and the service-name join.
create index if not exists idx_vehicles_agency on vehicles(agency_id);
create index if not exists idx_vehicles_service on vehicles(agency_service_id);

-- routes — the hottest column: listMyRoutes, getCounts, the RPCs
-- (agency_bookings / agency_students), and the student catalog all filter it.
create index if not exists idx_routes_agency on routes(agency_id);
create index if not exists idx_routes_service on routes(agency_service_id);
create index if not exists idx_routes_vehicle on routes(vehicle_id);
-- Student catalog: listAgenciesForInstitution / listAgencyRoutes filter by
-- institution_id + vehicle_type (+ agency_id).
create index if not exists idx_routes_inst_type on routes(institution_id, vehicle_type);

-- route_assignments / seat_allocations — joined for seat counts in
-- listAgencyRoutes and reserve_seat().
create index if not exists idx_route_assignments_route on route_assignments(route_id);
create index if not exists idx_seat_allocations_assignment on seat_allocations(route_assignment_id);

-- bookings — student listMyBookings + cancel (student_id), the agency RPCs and
-- hideStudent (route_id), and status filters (PENDING/CONFIRMED).
create index if not exists idx_bookings_student on bookings(student_id);
create index if not exists idx_bookings_route on bookings(route_id);
create index if not exists idx_bookings_status on bookings(status);

-- students — reserve_seat() / cancel_booking() and RLS look up
-- `where profile_id = auth.uid()` on every booking action.
create index if not exists idx_students_profile on students(profile_id);
