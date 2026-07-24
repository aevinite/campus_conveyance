-- 0089_route_stop_progress_indexes_and_dedup.sql (idempotent — requires 0086/0009)
-- Follow-ups to the 0086 driver stop-progress feature + a pre-existing race in
-- agency_service_requests.

-- (1) Index the three unindexed foreign keys on route_stop_progress. route_stops
--     are hard-deleted (0086 stop_id FK is ON DELETE CASCADE), so without an
--     index that cascade seq-scans this table; institution_id/recorded_by are
--     the same cheap-insurance case as the FKs indexed in 0087.
create index if not exists idx_rsp_stop_id       on route_stop_progress (stop_id);
create index if not exists idx_rsp_institution_id on route_stop_progress (institution_id);
create index if not exists idx_rsp_recorded_by   on route_stop_progress (recorded_by);

-- (2) driver_set_next_stop (0086) is delete-other-NEXT-then-insert, which under
--     two concurrent calls on the same route/day (READ COMMITTED) can leave TWO
--     NEXT rows. Enforce "at most one NEXT per route/day" at the DB level. First
--     dedupe any existing duplicates (keep the most recently recorded), then add
--     the partial unique index — the losing concurrent insert now 23505s instead
--     of creating a second NEXT.
delete from route_stop_progress a
using route_stop_progress b
where a.status = 'NEXT' and b.status = 'NEXT'
  and a.route_id = b.route_id
  and a.service_date = b.service_date
  and (a.recorded_at, a.ctid) < (b.recorded_at, b.ctid);

create unique index if not exists uq_rsp_next
  on route_stop_progress (route_id, service_date)
  where status = 'NEXT';

-- (3) requestServiceAction dedups PENDING requests with a check-then-insert,
--     which races (two submits → two PENDING rows for the same
--     agency+college+vehicle_type). Dedupe existing duplicates (keep the oldest
--     row per group), then add a partial unique index as the real guard; the app
--     now maps its 23505 to the same "already pending" message.
delete from agency_service_requests a
using agency_service_requests b
where a.status = 'PENDING' and b.status = 'PENDING'
  and a.agency_id = b.agency_id
  and a.institution_id = b.institution_id
  and a.vehicle_type = b.vehicle_type
  and a.ctid > b.ctid;

create unique index if not exists uq_asr_pending
  on agency_service_requests (agency_id, institution_id, vehicle_type)
  where status = 'PENDING';
