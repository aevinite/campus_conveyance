-- 0021_agency_drivers.sql (idempotent)
-- Drivers are created BY the agency (email + password). A driver belongs to an
-- agency (not necessarily an institution), so add agency_id and relax the
-- institution requirement.
alter table drivers add column if not exists agency_id uuid references agencies(id) on delete cascade;
alter table drivers alter column institution_id drop not null;
create index if not exists idx_drivers_agency on drivers(agency_id);

-- List a given agency's drivers with their login/profile info. SECURITY DEFINER:
-- drivers/profiles RLS would otherwise hide these rows from the agency.
create or replace function public.agency_drivers(p_agency_id uuid)
returns table (
  driver_id uuid, profile_id uuid, name text, email text, phone text,
  license_no text, is_active boolean, created_at timestamptz
) language sql stable security definer set search_path = public as $$
  select d.id, d.profile_id, pr.full_name, pr.email, pr.phone, d.license_no, d.is_active, d.created_at
  from drivers d
  left join profiles pr on pr.id = d.profile_id
  where d.agency_id = p_agency_id
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid())
  order by d.created_at desc;
$$;
grant execute on function public.agency_drivers(uuid) to authenticated;
