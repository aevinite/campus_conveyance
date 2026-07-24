-- Record (in the migration history) the six tables that were dropped live but
-- never removed from the migrations, so a fresh provision / DR restore / preview
-- branch converges to prod instead of resurrecting them (with their extra
-- ON DELETE CASCADE FKs and un-audited RLS). 0001 still CREATEs them and later
-- applied files (0002, 0024) reference them, so we DROP here at the end rather
-- than editing 0001's DDL (which would break those mid-sequence references on a
-- fresh rebuild). CASCADE clears their policies/triggers/indexes. Idempotent /
-- no-op on the live DB where they're already gone.
drop table if exists public.institution_admins cascade;
drop table if exists public.attendance cascade;
drop table if exists public.gps_tracking cascade;
drop table if exists public.complaints cascade;
drop table if exists public.subscriptions cascade;
drop table if exists public.settings cascade;
