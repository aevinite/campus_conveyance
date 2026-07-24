-- 0088_retention_route_stop_progress.sql (idempotent — requires 0064/0086)
-- route_stop_progress (0086) is written on every stop advance/skip but is only
-- ever DELETED for the CURRENT day (the driver RPCs scope to today's
-- service_date). The daily retention sweep — retention_cleanup(), last defined in
-- 0064 — was never taught about this new table, so rows for past days accumulate
-- forever. Extend the sweep to age them out.
--
-- 30 days: this is ephemeral per-day operational status (which stop is NEXT /
-- SKIPPED today), only read for the current service_date, so a month of history
-- is already generous. CREATE OR REPLACE preserves the existing grants, so the
-- 0071 lockdown (revoked from public/anon/authenticated) stays in force; we
-- re-assert it below for a clean-rebuild ordering guarantee.
create or replace function public.retention_cleanup() returns void
language sql security definer set search_path = public as $$
  delete from ride_events where created_at < now() - interval '90 days';
  delete from notifications
    where created_at < now() - interval '90 days'
       or (is_read = true and created_at < now() - interval '30 days');
  delete from parent_link_codes where expires_at < now() - interval '1 day';
  delete from audit_logs where created_at < now() - interval '180 days';
  delete from route_stop_progress
    where service_date < ((now() at time zone 'Asia/Kolkata')::date - 30);
$$;

revoke execute on function public.retention_cleanup() from public;
revoke execute on function public.retention_cleanup() from anon, authenticated;
