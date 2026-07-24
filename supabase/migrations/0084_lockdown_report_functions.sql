-- Lock down the report aggregation functions. admin_report() and
-- agency_report(uuid) are SECURITY DEFINER and self-authorize NOTHING, but their
-- original revokes (0053/0069) only targeted `authenticated`, leaving the default
-- EXECUTE-TO-PUBLIC grant. So ANY signed-in user could rpc('admin_report') (the
-- whole platform's revenue/fleet/student totals) or rpc('agency_report','<any
-- agency id>') (a competitor's revenue) — a cross-tenant financial-data leak.
-- These are only ever called by the SERVICE ROLE from cached repository helpers,
-- which bypass grants. Idempotent (revoke of an absent grant is a no-op).
-- Matches the 0071/0073 definer lockdown.

revoke execute on function public.admin_report() from public, anon, authenticated;
revoke execute on function public.agency_report(uuid) from public, anon, authenticated;
