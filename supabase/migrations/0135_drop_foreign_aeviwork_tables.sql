-- 0135: separate AeviWork from the Campus Conveyance database.
--
-- The aw_* tables were never part of Campus Conveyance: they belonged to a
-- separate app (AeviWork, aeviwork-next) that had been pointed at this
-- Supabase project. Its data now lives in its own dedicated Supabase project
-- ("aeviwork"), verified row-for-row identical before this drop, and the app
-- (local .env + Vercel envs) points there. Nothing in Campus Conveyance
-- references these tables.

drop table if exists public.aw_ratings cascade;
drop table if exists public.aw_payments cascade;
drop table if exists public.aw_welfare_claims cascade;
drop table if exists public.aw_certificates cascade;
drop table if exists public.aw_bookings cascade;
drop table if exists public.aw_worker_profiles cascade;
drop table if exists public.aw_users cascade;

insert into public.schema_migrations_applied (version, name) values ('0135', '0135_drop_foreign_aeviwork_tables') on conflict do nothing;
notify pgrst, 'reload schema';
