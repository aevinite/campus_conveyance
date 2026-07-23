-- Atomic rate-limit primitive. The app's rateLimit() previously did a SELECT
-- count then a separate INSERT — a TOCTOU window where two concurrent callers
-- both read "under the cap" and both insert, letting the authoritative Nominatim
-- 1/s cross-instance cap be exceeded (the exact condition that gets the server
-- IP banned). This does the count + conditional insert in ONE round-trip,
-- serialized per (scope,subject) by a transaction-scoped advisory lock.
--
-- Returns seconds-to-wait (>0 = over the cap, caller should back off) or 0 when
-- the call is allowed (and one event is recorded). Called only by the service
-- role from src/lib/rate-limit.ts.

create or replace function public.rate_limit_hit(
  p_scope text, p_subject text, p_max int, p_window_seconds int
) returns int language plpgsql security definer set search_path = public as $$
declare
  v_count int;
  v_oldest timestamptz;
  v_since timestamptz := now() - make_interval(secs => p_window_seconds);
begin
  -- Serialize concurrent callers for the SAME key so count+insert is atomic.
  perform pg_advisory_xact_lock(hashtextextended(p_scope || ':' || p_subject, 0));
  select count(*), min(created_at) into v_count, v_oldest
    from rate_limit_events
    where scope = p_scope and subject = p_subject and created_at >= v_since;
  if v_count >= p_max then
    return greatest(
      1,
      ceil(extract(epoch from (v_oldest + make_interval(secs => p_window_seconds) - now())))
    )::int;
  end if;
  insert into rate_limit_events (scope, subject) values (p_scope, p_subject);
  return 0;
end $$;

revoke execute on function public.rate_limit_hit(text, text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, text, int, int) to service_role;
