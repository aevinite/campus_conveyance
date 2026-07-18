-- 0036_agency_services_unique.sql (idempotent)
-- Stop duplicate service listings.
--
-- Approving a service-area request twice (double-click / concurrent admins)
-- inserted a second agency_services row for the same agency+college+vehicle_type,
-- and students then saw that provider listed twice. The approve action is now
-- atomic (claim the request PENDING→APPROVED first, then upsert), and this unique
-- index is the DB-level backstop so a duplicate listing simply cannot exist.

-- Collapse any duplicates that already exist (keep the earliest row per key).
delete from agency_services a
 using agency_services dup
 where a.agency_id = dup.agency_id
   and a.institution_id = dup.institution_id
   and a.vehicle_type = dup.vehicle_type
   and (dup.created_at, dup.id) < (a.created_at, a.id);

create unique index if not exists uq_agency_services_triple
  on agency_services (agency_id, institution_id, vehicle_type);
