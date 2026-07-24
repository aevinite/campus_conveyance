-- Index the two remaining un-indexed foreign keys that reference profiles(id):
--   • agencies.approved_by            (added in 0005)
--   • agency_service_requests.reviewed_by (added in 0009)
-- Both are plain (NO ACTION) FKs. Without a covering index, deleting or updating
-- the referenced profile row forces a sequential scan of the child table to check
-- for dependents, and any lookup "who did admin X approve/review" is a seq scan
-- too. These tables are small today, so a normal (non-CONCURRENT) build is fine
-- and keeps this migration in-band with the rest.
--
-- Numbering note: there is no 0082 — that slot was used by a migration that was
-- superseded and removed before it ever reached the live database, so the gap is
-- intentional. Migrations apply in filename order regardless of gaps.

create index if not exists idx_agencies_approved_by
  on public.agencies (approved_by);

create index if not exists idx_asr_reviewed_by
  on public.agency_service_requests (reviewed_by);
