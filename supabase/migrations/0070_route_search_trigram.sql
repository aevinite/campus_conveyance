-- Route search (institution_routes / _count, migration 0068) filters with
-- leading-wildcard ILIKE on routes.name and agencies.name:
--     r.name ilike '%' || p_query || '%'
--     a.name ilike '%' || p_query || '%'
-- A leading '%' can't use a B-tree, so this is a seq scan today. pg_trgm GIN
-- indexes make `ILIKE '%...%'` sargable, keeping campus route search fast as the
-- catalog grows. Idempotent + additive (no signature/behaviour change).

create extension if not exists pg_trgm;

create index if not exists idx_routes_name_trgm
  on public.routes using gin (name gin_trgm_ops);

create index if not exists idx_agencies_name_trgm
  on public.agencies using gin (name gin_trgm_ops);
