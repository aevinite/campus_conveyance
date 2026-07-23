-- Pin search_path on the JWT claim helpers for consistency with the token hook
-- (custom_access_token_hook already sets it, 0002). Low risk — they only call
-- auth.jwt() — but an unpinned search_path on a function used inside RLS policies
-- is a hardening gap worth closing. Idempotent create-or-replace; bodies
-- unchanged from 0002.

create or replace function public.jwt_institution() returns uuid
language sql stable set search_path = public as $$
  select nullif(auth.jwt()->'app_metadata'->>'institution_id','')::uuid;
$$;

create or replace function public.jwt_role() returns text
language sql stable set search_path = public as $$
  select auth.jwt()->'app_metadata'->>'role';
$$;
