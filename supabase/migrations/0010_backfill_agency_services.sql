-- 0010_backfill_agency_services.sql (idempotent)
-- Agencies that signed up before 0009's trigger seeding have no agency_services,
-- so they don't show under the college they picked and are asked to re-request.
-- Backfill their services from the institutions × vehicle types they chose at
-- signup (stored in the owner's auth metadata). Safe to re-run — the NOT EXISTS
-- guard skips any service that already exists.
insert into public.agency_services (agency_id, institution_id, name, vehicle_type)
select a.id,
       inst::uuid,
       coalesce(u.raw_user_meta_data->>'full_name', a.name, 'Service')
         || ' — ' || (case when vt = 'VAN' then 'Van' else 'Bus' end),
       vt::vehicle_type
from public.agencies a
join auth.users u on u.id = a.owner_profile_id
cross join lateral jsonb_array_elements_text(
  coalesce(u.raw_user_meta_data->'institution_ids','[]'::jsonb)) as inst
cross join lateral jsonb_array_elements_text(
  coalesce(u.raw_user_meta_data->'vehicle_types','[]'::jsonb)) as vt
where a.is_deleted = false
  and inst ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and vt in ('BUS','VAN')
  and exists (select 1 from public.institutions i where i.id = inst::uuid)
  and not exists (
    select 1 from public.agency_services s
    where s.agency_id = a.id
      and s.institution_id = inst::uuid
      and s.vehicle_type = vt::vehicle_type
  );
