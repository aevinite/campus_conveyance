-- 0048_driver_full_profile.sql (idempotent — requires 0021/0046/0047)
-- Registered drivers (Manage Drivers) now carry the same safety profile as a
-- bus's driver: Aadhaar/ID, home address, blood group, DOB, alternate contact
-- (licence already existed). This makes the roster a real KYC record, and the
-- details flow to riders when the driver stands in as a substitute.

alter table drivers add column if not exists aadhaar_no text;
alter table drivers add column if not exists address text;
alter table drivers add column if not exists blood_group text;
alter table drivers add column if not exists dob date;
alter table drivers add column if not exists alt_phone text;

-- agency_drivers returns the full profile (drop + recreate — return type changes).
drop function if exists public.agency_drivers(uuid);
create or replace function public.agency_drivers(p_agency_id uuid)
returns table (
  driver_id uuid, profile_id uuid, name text, email text, phone text,
  license_no text, aadhaar_no text, address text, blood_group text, dob date, alt_phone text,
  is_active boolean, created_at timestamptz
) language sql stable security definer set search_path = public as $$
  select d.id, d.profile_id, pr.full_name, pr.email, pr.phone,
         d.license_no, d.aadhaar_no, d.address, d.blood_group, d.dob, d.alt_phone,
         d.is_active, d.created_at
  from drivers d
  left join profiles pr on pr.id = d.profile_id
  where d.agency_id = p_agency_id
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid())
  order by d.created_at desc;
$$;
grant execute on function public.agency_drivers(uuid) to authenticated;

-- Substitute snapshot carries the safety fields, so riders see the full profile
-- of a stand-in driver/conductor too.
alter table bus_driver_changes add column if not exists driver_govt_id text;
alter table bus_driver_changes add column if not exists driver_blood_group text;
alter table bus_driver_changes add column if not exists driver_alt_phone text;

drop function if exists public.set_bus_driver_today_by_driver(uuid, uuid, text, text);
create or replace function public.set_bus_driver_today_by_driver(
  p_vehicle_id uuid, p_driver_id uuid, p_reason text, p_role text default 'DRIVER'
) returns bus_driver_changes language plpgsql security definer set search_path = public as $$
declare v_agency uuid; v_row bus_driver_changes;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_dagency uuid; v_active boolean; v_name text; v_phone text; v_license text;
  v_govt text; v_blood text; v_alt text;
begin
  if p_role not in ('DRIVER', 'CONDUCTOR') then
    raise exception 'Invalid role' using errcode='P0005'; end if;

  select v.agency_id into v_agency
    from vehicles v join agencies a on a.id = v.agency_id
   where v.id = p_vehicle_id and a.owner_profile_id = auth.uid();
  if v_agency is null then raise exception 'Not your bus' using errcode='P0003'; end if;

  select d.agency_id, d.is_active, coalesce(pr.full_name, pr.email, 'Staff'), pr.phone,
         d.license_no, d.aadhaar_no, d.blood_group, d.alt_phone
    into v_dagency, v_active, v_name, v_phone, v_license, v_govt, v_blood, v_alt
    from drivers d left join profiles pr on pr.id = d.profile_id
   where d.id = p_driver_id;
  if v_dagency is null or v_dagency <> v_agency then
    raise exception 'That person is not registered with your agency' using errcode='P0005'; end if;
  if not coalesce(v_active, false) then
    raise exception 'That person is inactive — activate them in Manage Drivers first' using errcode='P0005'; end if;

  if exists (select 1 from vehicles where driver_id = p_driver_id) then
    raise exception 'That person is already assigned to a bus — pick an unassigned one' using errcode='P0005'; end if;
  if exists (select 1 from bus_driver_changes
              where driver_id = p_driver_id and effective_date = v_today
                and not (vehicle_id = p_vehicle_id and role = p_role)) then
    raise exception 'That person is already a substitute somewhere today' using errcode='P0005'; end if;

  insert into bus_driver_changes
    (vehicle_id, agency_id, role, driver_id, driver_name, driver_phone, driver_license_no,
     driver_govt_id, driver_blood_group, driver_alt_phone, reason, effective_date)
  values
    (p_vehicle_id, v_agency, p_role, p_driver_id, v_name, v_phone,
     case when p_role = 'DRIVER' then v_license end,
     v_govt, v_blood, v_alt, nullif(trim(coalesce(p_reason, '')), ''), v_today)
  on conflict (vehicle_id, role, effective_date) do update
    set driver_id = excluded.driver_id,
        driver_name = excluded.driver_name,
        driver_phone = excluded.driver_phone,
        driver_license_no = excluded.driver_license_no,
        driver_govt_id = excluded.driver_govt_id,
        driver_blood_group = excluded.driver_blood_group,
        driver_alt_phone = excluded.driver_alt_phone,
        reason = excluded.reason,
        updated_at = now()
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.set_bus_driver_today_by_driver(uuid, uuid, text, text) to authenticated;
