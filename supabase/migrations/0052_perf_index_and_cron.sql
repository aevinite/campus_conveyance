-- 0052_perf_index_and_cron.sql (idempotent)
-- (6) Hot-path index. reserve_seat / promote_waitlist_for / sync_reserved_seats
-- all count `bookings where seat_allocation_id = X and status in (...)` under the
-- allocation lock — with no index on seat_allocation_id that was a live-confirmed
-- Seq Scan on the most contended write path. Composite (seat_allocation_id,
-- status) serves the count directly.
create index if not exists idx_bookings_alloc_status
  on public.bookings (seat_allocation_id, status);

-- (7) Move expire_stale_holds off the request path. It ran as a table UPDATE on
-- every booking-surface page render (6 pages) → write-amplification that
-- serializes on PENDING rows under traffic. Run it once a minute via pg_cron
-- instead. reserve_seat still calls it inline, so seat availability is exact at
-- the one moment it matters (reservation); pages tolerate <=60s of staleness.
create extension if not exists pg_cron;
-- cron.schedule upserts by job name, so re-running this migration just updates it.
select cron.schedule('expire-stale-holds', '* * * * *', $$ select public.expire_stale_holds(); $$);
