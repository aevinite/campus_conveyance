-- 0009_agency_service_requests.sql (idempotent)
-- Fixes three related agency-onboarding gaps:
--   1. Signup selections (institutions × vehicle types) never became services, so
--      an approved provider never showed under the college it picked. Now the
--      new-user trigger seeds an agency_services row per selection.
--   2. Because nothing was seeded, the provider had to re-enter everything in the
--      panel. With seeding, its services are already there after approval.
--   3. Adding/changing a service area now goes through an admin-reviewed request
--      (with a required description) instead of an instant insert.

----------------------------------------------------------------------
-- 1. Seed services from signup metadata (institutions × vehicle types)
----------------------------------------------------------------------
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

    -- One service per (selected institution × selected vehicle type). Named after
    -- the provider so the panel dropdowns are meaningful without re-entry.
    insert into public.agency_services (agency_id, institution_id, name, vehicle_type)
    select v_agency_id,
           inst::uuid,
           coalesce(new.raw_user_meta_data->>'full_name','Service')
             || ' — ' || (case when vt = 'VAN' then 'Van' else 'Bus' end),
           vt::vehicle_type
    from jsonb_array_elements_text(coalesce(new.raw_user_meta_data->'institution_ids','[]'::jsonb)) as inst,
         jsonb_array_elements_text(coalesce(new.raw_user_meta_data->'vehicle_types','[]'::jsonb)) as vt
    where inst ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and vt in ('BUS','VAN');
  end if;
  return new;
end; $$;

----------------------------------------------------------------------
-- 2. Service-area change requests (admin reviewed)
----------------------------------------------------------------------
create table if not exists agency_service_requests (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  institution_id uuid not null references institutions(id) on delete cascade,
  vehicle_type vehicle_type not null default 'BUS',
  name text not null,
  description text not null,
  status agency_status not null default 'PENDING',
  rejected_reason text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references profiles(id)
);
create index if not exists idx_asr_status on agency_service_requests(status);
create index if not exists idx_asr_agency on agency_service_requests(agency_id);

alter table agency_service_requests enable row level security;

-- Read: the owning agency sees its own; admins see all.
drop policy if exists asr_read on agency_service_requests;
create policy asr_read on agency_service_requests for select to authenticated
  using (public.jwt_role()='SUPER_ADMIN'
    or agency_id in (select id from agencies where owner_profile_id=auth.uid()));

-- Insert: only the owning, APPROVED agency may request a new service area.
drop policy if exists asr_insert on agency_service_requests;
create policy asr_insert on agency_service_requests for insert to authenticated
  with check (agency_id in
    (select id from agencies where owner_profile_id=auth.uid() and status='APPROVED'));

-- Update: admins only (approve / reject).
drop policy if exists asr_admin_update on agency_service_requests;
create policy asr_admin_update on agency_service_requests for update to authenticated
  using (public.jwt_role()='SUPER_ADMIN') with check (public.jwt_role()='SUPER_ADMIN');
