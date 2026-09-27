-- 0124_service_request_two_stage.sql (idempotent)
-- Two-stage approval for agency service-area requests:
--   agency files → CAMPUS decides first → then platform ADMIN gives final approval
--   (only the admin approval creates the live agency_services row).
--
-- The existing `status` column (agency_status enum: PENDING/APPROVED/REJECTED)
-- now tracks the ADMIN's final decision. We add `campus_status` (same enum) to
-- track the CAMPUS decision independently, so we never have to widen the shared
-- enum. Derived stages the UI shows:
--   campus_status=PENDING                      → "Awaiting campus"
--   campus_status=APPROVED & status=PENDING    → "Awaiting admin"
--   status=APPROVED                            → "Approved · Live"
--   campus_status=REJECTED                     → "Rejected by campus"
--   campus_status=APPROVED & status=REJECTED   → "Rejected by admin"

alter table agency_service_requests
  add column if not exists campus_status agency_status not null default 'PENDING';

-- Backfill history so old rows render sensibly under the new two-stage model:
--   • already-live (status=APPROVED)  → the campus is implicitly APPROVED too.
--   • already-rejected (status=REJECTED) → treat as a campus-level rejection
--     (the old single-stage flow didn't distinguish who rejected).
update agency_service_requests set campus_status = 'APPROVED'
  where status = 'APPROVED' and campus_status <> 'APPROVED';
update agency_service_requests set campus_status = 'REJECTED'
  where status = 'REJECTED' and campus_status = 'PENDING';

create index if not exists idx_asr_campus_status on agency_service_requests(campus_status);
