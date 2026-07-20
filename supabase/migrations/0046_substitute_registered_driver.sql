-- 0046_substitute_registered_driver.sql (idempotent — requires 0041)
-- "Change driver for today" must now pick a REGISTERED driver of the agency, not
-- a free-typed name. The chosen driver must be:
--   • registered with this agency (drivers row) and active, and
--   • not the permanent driver of any bus (unassigned), and
--   • not already the substitute on another bus today.
-- The driver's name/phone/licence are snapshotted onto the change row from their
-- profile, so all the rider-facing displays keep working unchanged.

alter table bus_driver_changes
  add column if not exists driver_id uuid references drivers(id) on delete set null;

create or replace function public.set_bus_driver_today_by_driver(
  p_vehicle_id uuid, p_driver_id uuid, p_reason text
) returns bus_driver_changes language plpgsql security definer set search_path = public as $$
declare v_agency uuid; v_row bus_driver_changes;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_dagency uuid; v_active boolean; v_name text; v_phone text; v_license text;
begin
  -- Caller must own the agency that owns this bus.
  select v.agency_id into v_agency
    from vehicles v join agencies a on a.id = v.agency_id
   where v.id = p_vehicle_id and a.owner_profile_id = auth.uid();
  if v_agency is null then raise exception 'Not your bus' using errcode='P0003'; end if;

  -- Driver must be registered with THIS agency and active.
  select d.agency_id, d.is_active, coalesce(pr.full_name, pr.email, 'Driver'), pr.phone, d.license_no
    into v_dagency, v_active, v_name, v_phone, v_license
    from drivers d left join profiles pr on pr.id = d.profile_id
   where d.id = p_driver_id;
  if v_dagency is null or v_dagency <> v_agency then
    raise exception 'That driver is not registered with your agency' using errcode='P0005'; end if;
  if not coalesce(v_active, false) then
    raise exception 'That driver is inactive — activate them in Manage Drivers first' using errcode='P0005'; end if;

  -- Must be free: not the permanent driver of any bus.
  if exists (select 1 from vehicles where driver_id = p_driver_id) then
    raise exception 'That driver is already assigned to a bus — pick an unassigned driver' using errcode='P0005'; end if;
  -- Can't drive two buses at once: not already a substitute elsewhere today.
  if exists (select 1 from bus_driver_changes
              where driver_id = p_driver_id and effective_date = v_today and vehicle_id <> p_vehicle_id) then
    raise exception 'That driver is already the substitute on another bus today' using errcode='P0005'; end if;

  insert into bus_driver_changes
    (vehicle_id, agency_id, driver_id, driver_name, driver_phone, driver_license_no, reason, effective_date)
  values
    (p_vehicle_id, v_agency, p_driver_id, v_name, v_phone, v_license,
     nullif(trim(coalesce(p_reason, '')), ''), v_today)
  on conflict (vehicle_id, effective_date) do update
    set driver_id = excluded.driver_id,
        driver_name = excluded.driver_name,
        driver_phone = excluded.driver_phone,
        driver_license_no = excluded.driver_license_no,
        reason = excluded.reason,
        updated_at = now()
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.set_bus_driver_today_by_driver(uuid, uuid, text) to authenticated;
