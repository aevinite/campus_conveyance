-- 0049_driver_soft_delete.sql (idempotent — requires 0048)
-- Two-stage driver removal in the agency panel:
--   • Manage Drivers → Delete  = SOFT delete (is_deleted=true) → moves to "Deleted Drivers".
--   • Deleted Drivers → Restore = brings it back; Delete = HARD delete (done in the
--     server action: removes the drivers row + the login/auth user permanently).
alter table drivers add column if not exists is_deleted boolean not null default false;
alter table drivers add column if not exists deleted_at timestamptz;

-- agency_drivers now returns is_deleted so the two pages can split the roster.
drop function if exists public.agency_drivers(uuid);
create or replace function public.agency_drivers(p_agency_id uuid)
returns table (
  driver_id uuid, profile_id uuid, name text, email text, phone text,
  license_no text, aadhaar_no text, address text, blood_group text, dob date, alt_phone text,
  is_active boolean, is_deleted boolean, created_at timestamptz
) language sql stable security definer set search_path = public as $$
  select d.id, d.profile_id, pr.full_name, pr.email, pr.phone,
         d.license_no, d.aadhaar_no, d.address, d.blood_group, d.dob, d.alt_phone,
         d.is_active, d.is_deleted, d.created_at
  from drivers d
  left join profiles pr on pr.id = d.profile_id
  where d.agency_id = p_agency_id
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid())
  order by d.created_at desc;
$$;
grant execute on function public.agency_drivers(uuid) to authenticated;
