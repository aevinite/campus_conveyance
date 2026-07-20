-- 0054_rate_limit_cleanup_and_route_bookings.sql (idempotent)
-- (2) rate_limit_events only self-pruned the current key on each request, so keys
-- that stopped being hit (one-off IPs/emails) accumulated forever. A pg_cron job
-- (extension enabled in 0052) sweeps anything older than a day — well past the
-- longest window (1h). cron.schedule upserts by name.
select cron.schedule(
  'rate-limit-cleanup', '*/15 * * * *',
  $$ delete from public.rate_limit_events where created_at < now() - interval '1 day'; $$
);

-- (3) Which of the given routes have at least one booking — returned as DISTINCT
-- route ids, so listMyRoutesFull can set its hasBookings flag without pulling
-- EVERY booking row for a popular route into Node just to build a Set. Plain SQL
-- (no security definer) so it runs under the caller's RLS.
create or replace function public.routes_with_bookings(p_route_ids uuid[])
returns setof uuid language sql stable set search_path = public as $$
  select distinct route_id from bookings where route_id = any(p_route_ids);
$$;
grant execute on function public.routes_with_bookings(uuid[]) to authenticated;
