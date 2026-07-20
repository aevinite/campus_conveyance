-- 0047_conductor.sql (idempotent — requires 0041/0042/0046)
-- Every bus now has a CONDUCTOR as well as a driver. The conductor carries the
-- same trust/safety profile as the driver (minus the driving licence — they
-- don't drive), and can be substituted for the day just like the driver.

-- 1) Conductor profile on the bus (mirrors the driver's 0042 fields).
alter table vehicles add column if not exists conductor_name text;
alter table vehicles add column if not exists conductor_phone text;
alter table vehicles add column if not exists conductor_govt_id text;
alter table vehicles add column if not exists conductor_address text;
alter table vehicles add column if not exists conductor_alt_phone text;
alter table vehicles add column if not exists conductor_dob date;
alter table vehicles add column if not exists conductor_blood_group text;
alter table vehicles add column if not exists conductor_verified boolean not null default false;

-- 2) The per-day substitute table now covers BOTH roles.
alter table bus_driver_changes add column if not exists role text not null default 'DRIVER';
alter table bus_driver_changes drop constraint if exists bus_driver_changes_role_chk;
alter table bus_driver_changes add constraint bus_driver_changes_role_chk check (role in ('DRIVER', 'CONDUCTOR'));
-- One substitute per bus PER ROLE per day (replaces the old vehicle+day unique).
drop index if exists uq_bus_driver_change_day;
create unique index if not exists uq_bus_driver_change_role_day
  on bus_driver_changes(vehicle_id, role, effective_date);

-- 3) set/clear now take a role. Drop the old signatures first so there's no
--    ambiguity, then recreate.
drop function if exists public.set_bus_driver_today_by_driver(uuid, uuid, text);
create or replace function public.set_bus_driver_today_by_driver(
  p_vehicle_id uuid, p_driver_id uuid, p_reason text, p_role text default 'DRIVER'
) returns bus_driver_changes language plpgsql security definer set search_path = public as $$
declare v_agency uuid; v_row bus_driver_changes;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_dagency uuid; v_active boolean; v_name text; v_phone text; v_license text;
begin
  if p_role not in ('DRIVER', 'CONDUCTOR') then
    raise exception 'Invalid role' using errcode='P0005'; end if;

  select v.agency_id into v_agency
    from vehicles v join agencies a on a.id = v.agency_id
   where v.id = p_vehicle_id and a.owner_profile_id = auth.uid();
  if v_agency is null then raise exception 'Not your bus' using errcode='P0003'; end if;

  select d.agency_id, d.is_active, coalesce(pr.full_name, pr.email, 'Staff'), pr.phone, d.license_no
    into v_dagency, v_active, v_name, v_phone, v_license
    from drivers d left join profiles pr on pr.id = d.profile_id
   where d.id = p_driver_id;
  if v_dagency is null or v_dagency <> v_agency then
    raise exception 'That person is not registered with your agency' using errcode='P0005'; end if;
  if not coalesce(v_active, false) then
    raise exception 'That person is inactive — activate them in Manage Drivers first' using errcode='P0005'; end if;

  -- Must be free: not the permanent driver of any bus.
  if exists (select 1 from vehicles where driver_id = p_driver_id) then
    raise exception 'That person is already assigned to a bus — pick an unassigned one' using errcode='P0005'; end if;
  -- Can't be in two places at once: not already a substitute elsewhere today
  -- (any role), nor the other role on this same bus today.
  if exists (select 1 from bus_driver_changes
              where driver_id = p_driver_id and effective_date = v_today
                and not (vehicle_id = p_vehicle_id and role = p_role)) then
    raise exception 'That person is already a substitute somewhere today' using errcode='P0005'; end if;

  insert into bus_driver_changes
    (vehicle_id, agency_id, role, driver_id, driver_name, driver_phone, driver_license_no, reason, effective_date)
  values
    (p_vehicle_id, v_agency, p_role, p_driver_id, v_name, v_phone,
     case when p_role = 'DRIVER' then v_license end,
     nullif(trim(coalesce(p_reason, '')), ''), v_today)
  on conflict (vehicle_id, role, effective_date) do update
    set driver_id = excluded.driver_id,
        driver_name = excluded.driver_name,
        driver_phone = excluded.driver_phone,
        driver_license_no = excluded.driver_license_no,
        reason = excluded.reason,
        updated_at = now()
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.set_bus_driver_today_by_driver(uuid, uuid, text, text) to authenticated;

drop function if exists public.clear_bus_driver_today(uuid);
create or replace function public.clear_bus_driver_today(p_vehicle_id uuid, p_role text default 'DRIVER')
returns void language plpgsql security definer set search_path = public as $$
declare v_agency uuid; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select v.agency_id into v_agency
    from vehicles v join agencies a on a.id = v.agency_id
   where v.id = p_vehicle_id and a.owner_profile_id = auth.uid();
  if v_agency is null then raise exception 'Not your bus' using errcode='P0003'; end if;
  delete from bus_driver_changes
   where vehicle_id = p_vehicle_id and role = p_role and effective_date = v_today;
end; $$;
grant execute on function public.clear_bus_driver_today(uuid, text) to authenticated;

-- 4) Parent bookings join must now target the DRIVER-role override specifically
--    (a conductor override would otherwise duplicate/replace the driver row).
drop function if exists public.parent_children_bookings();
create or replace function public.parent_children_bookings()
returns table (booking_id uuid, student_id uuid, student_name text,
               route_name text, institution_name text, status text,
               is_paid boolean, created_at timestamptz, pickup_name text,
               departure_time time, bus_number text,
               driver_name text, driver_phone text, driver_changed boolean,
               route_id uuid)
language sql stable security definer set search_path = public as $$
  select b.id, s.id, coalesce(pr.full_name, b.student_name),
         coalesce(r.name, r.start_location), i.name, b.status::text,
         b.is_paid, b.created_at, st.name,
         r.departure_time, v.bus_number,
         coalesce(dc.driver_name, v.driver_name),
         coalesce(dc.driver_phone, v.driver_phone),
         (dc.id is not null),
         r.id
  from parent_students ps
  join parents pa on pa.id = ps.parent_id and pa.profile_id = auth.uid()
  join students s on s.id = ps.student_id
  join bookings b on b.student_id = s.id
  join routes r on r.id = b.route_id
  left join institutions i on i.id = r.institution_id
  left join vehicles v on v.id = r.vehicle_id
  left join bus_driver_changes dc
    on dc.vehicle_id = v.id and dc.role = 'DRIVER'
   and dc.effective_date = (now() at time zone 'Asia/Kolkata')::date
  left join route_stops st on st.id = b.pickup_stop_id
  left join profiles pr on pr.id = s.profile_id
  order by b.created_at desc;
$$;
grant execute on function public.parent_children_bookings() to authenticated;
