-- Lock down two SECURITY DEFINER functions that keep Postgres' default
-- EXECUTE-TO-PUBLIC grant even though neither is meant to be called directly by
-- a client. Both are reached WITHOUT a direct grant:
--   * promote_waitlist_for(uuid) — only invoked via `perform` inside the
--     waitlist trigger functions (0035), which run as their definer/owner. A
--     trigger does not require the invoking user to hold EXECUTE on it.
--   * retention_cleanup() — only invoked by the pg_cron job (0061), which runs
--     as the job owner.
-- So revoking EXECUTE from clients removes a directly-reachable unchecked
-- definer write / destructive DELETE without affecting the trigger or cron path.
-- Idempotent: REVOKE of an absent grant is a no-op. Matches the admin_report /
-- agency_report lockdown (0053).

revoke execute on function public.promote_waitlist_for(uuid) from public;
revoke execute on function public.promote_waitlist_for(uuid) from anon, authenticated;

revoke execute on function public.retention_cleanup() from public;
revoke execute on function public.retention_cleanup() from anon, authenticated;
