-- ⚠️ OUT-OF-BAND MIGRATION — DO NOT run this file through the normal migration
-- runner / db:provision, and do NOT wrap it in a transaction.
--
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block, and each
-- statement acquires only a brief ShareUpdateExclusive lock (no write-blocking).
-- Apply these ONE AT A TIME, each as its own statement, in a low-traffic window
-- (e.g. paste individually into the Supabase SQL editor, or psql without a txn).
-- These cover the large / hot tables split out of 0081 + the expire sweep so a
-- plain CREATE INDEX doesn't stall the GPS / notification / booking write paths.
--
-- If a build is interrupted it can leave an INVALID index — drop and recreate:
--   drop index concurrently if exists <name>;

create index concurrently if not exists idx_audit_logs_actor on audit_logs(actor_id);
create index concurrently if not exists idx_notifications_institution on notifications(institution_id);
-- (gps_tracking was dropped live — see 0085 — so no index for it here.)
-- bookings.pickup_stop_id/drop_stop_id are NO ACTION FKs → speed the delete-time
-- check (and stop lookups); the partial index serves expire_stale_holds().
create index concurrently if not exists idx_bookings_pickup_stop on bookings(pickup_stop_id);
create index concurrently if not exists idx_bookings_drop_stop on bookings(drop_stop_id);
-- Predicate mirrors the sweep's WHERE (status='PENDING' AND expires_at IS NOT
-- NULL); `expires_at < now()` can't be in a partial-index predicate (now() isn't
-- immutable), so the index just narrows to lapsing candidates.
create index concurrently if not exists idx_bookings_pending_expiry
  on bookings(expires_at) where status = 'PENDING' and expires_at is not null;
