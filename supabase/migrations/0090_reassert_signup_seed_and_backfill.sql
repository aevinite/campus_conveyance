-- 0090_reassert_signup_seed_and_backfill.sql (idempotent — requires 0009/0010)
-- H1: freshly-approved agencies served no college. The 0009 signup trigger that
-- seeds agency_services from the owner's institution_ids × vehicle_types drifted
-- on live (an older handle_new_user without the seeding block is deployed), so
-- the row was never created. The app now ALSO seeds at admin approval
-- (seedAgencyServicesFromSignup), which is the primary fix; this migration
-- (a) re-asserts the correct trigger so a fresh/re-provisioned DB is right and any
-- env that applies migrations converges, and (b) backfills existing agencies that
-- were approved while the drift was in place.

-- (a) Re-assert the signup trigger with the service-seeding block (verbatim 0009).
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_role public.user_role; v_agency_id uuid;
begin
  v_role := coalesce((new.raw_user_meta_data->>'role')::public.user_role,'STUDENT');
  insert into public.profiles (id, full_name, email, role)
  values (new.id, new.raw_user_meta_data->>'full_name', new.email, v_role);

  if v_role = 'AGENCY' then
    insert into public.agencies (owner_profile_id, name, email, phone, contact_person,
      legal_name, registration_no, gst_number, pan_number, registered_address,
      permit_doc_url, fitness_doc_url, status)
    values (new.id,
      coalesce(new.raw_user_meta_data->>'full_name','Agency'),
      new.email,
      new.raw_user_meta_data->>'phone',
      new.raw_user_meta_data->>'contact_person',
      new.raw_user_meta_data->>'legal_name',
      new.raw_user_meta_data->>'registration_no',
      new.raw_user_meta_data->>'gst_number',
      new.raw_user_meta_data->>'pan_number',
      new.raw_user_meta_data->>'registered_address',
      nullif(new.raw_user_meta_data->>'permit_doc_url',''),
      nullif(new.raw_user_meta_data->>'fitness_doc_url',''),
      'PENDING')
    returning id into v_agency_id;

    insert into public.agency_services (agency_id, institution_id, name, vehicle_type)
    select v_agency_id,
           inst::uuid,
           coalesce(new.raw_user_meta_data->>'full_name','Service')
             || ' — ' || (case when vt = 'VAN' then 'Van' else 'Bus' end),
           vt::vehicle_type
    from jsonb_array_elements_text(coalesce(new.raw_user_meta_data->'institution_ids','[]'::jsonb)) as inst,
         jsonb_array_elements_text(coalesce(new.raw_user_meta_data->'vehicle_types','[]'::jsonb)) as vt
    where inst ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and vt in ('BUS','VAN')
    on conflict (agency_id, institution_id, vehicle_type) do nothing;
  end if;
  return new;
end; $$;

-- (b) Backfill services for agencies that already exist (heals the ones approved
-- during the drift). Safe to re-run — the unique index makes the insert a no-op
-- for services that already exist.
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
  and exists (select 1 from public.institutions i where i.id = inst::uuid and i.is_deleted = false)
on conflict (agency_id, institution_id, vehicle_type) do nothing;
