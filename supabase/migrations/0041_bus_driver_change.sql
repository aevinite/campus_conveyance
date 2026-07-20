-- 0041_bus_driver_change.sql (idempotent)
-- Substitute driver for a bus, per day. When the regular driver doesn't turn up,
-- the agency records a replacement driver for that bus for TODAY. Students and
-- parents who booked that bus then see the substitute (name/phone) with a
-- "Driver changed for today" notice. The regular driver on `vehicles` is left
-- untouched; the override simply applies for its effective_date.
-- "Today" is IST (Asia/Kolkata) so the change lines up with the local service day.

create table if not exists bus_driver_changes (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  driver_name text not null,
  driver_phone text,
  driver_license_no text,
  reason text,
  effective_date date not null default (now() at time zone 'Asia/Kolkata')::date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One substitute per bus per day.
create unique index if not exists uq_bus_driver_change_day
  on bus_driver_changes(vehicle_id, effective_date);

alter table bus_driver_changes enable row level security;
-- Read is open to any signed-in user: students/parents must see today's driver of
-- a bus they booked, and the fields (name/phone) are already shown to them anyway.
drop policy if exists bus_driver_changes_read on bus_driver_changes;
create policy bus_driver_changes_read on bus_driver_changes
  for select to authenticated using (true);
-- Writes go only through the security-definer RPCs below (owner-checked).

-- Set (or replace) TODAY's substitute driver for a bus the caller's agency owns.
create or replace function public.set_bus_driver_today(
  p_vehicle_id uuid, p_driver_name text, p_driver_phone text,
  p_driver_license_no text, p_reason text
) returns bus_driver_changes language plpgsql security definer set search_path = public as $$
declare v_agency uuid; v_row bus_driver_changes;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select v.agency_id into v_agency
    from vehicles v join agencies a on a.id = v.agency_id
   where v.id = p_vehicle_id and a.owner_profile_id = auth.uid();
  if v_agency is null then raise exception 'Not your bus' using errcode='P0003'; end if;
  if coalesce(trim(p_driver_name), '') = '' then
    raise exception 'Enter the substitute driver''s name' using errcode='P0005'; end if;

  insert into bus_driver_changes
    (vehicle_id, agency_id, driver_name, driver_phone, driver_license_no, reason, effective_date)
  values
    (p_vehicle_id, v_agency, trim(p_driver_name),
     nullif(trim(coalesce(p_driver_phone, '')), ''),
     nullif(trim(coalesce(p_driver_license_no, '')), ''),
     nullif(trim(coalesce(p_reason, '')), ''), v_today)
  on conflict (vehicle_id, effective_date) do update
    set driver_name = excluded.driver_name,
        driver_phone = excluded.driver_phone,
        driver_license_no = excluded.driver_license_no,
        reason = excluded.reason,
        updated_at = now()
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.set_bus_driver_today(uuid, text, text, text, text) to authenticated;

-- Revert: remove TODAY's substitute so the bus shows its regular driver again.
create or replace function public.clear_bus_driver_today(p_vehicle_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_agency uuid; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select v.agency_id into v_agency
    from vehicles v join agencies a on a.id = v.agency_id
   where v.id = p_vehicle_id and a.owner_profile_id = auth.uid();
  if v_agency is null then raise exception 'Not your bus' using errcode='P0003'; end if;
  delete from bus_driver_changes where vehicle_id = p_vehicle_id and effective_date = v_today;
end; $$;
grant execute on function public.clear_bus_driver_today(uuid) to authenticated;

-- Parent bookings: surface today's substitute driver + a changed flag.
drop function if exists public.parent_children_bookings();
create or replace function public.parent_children_bookings()
returns table (booking_id uuid, student_id uuid, student_name text,
               route_name text, institution_name text, status text,
               is_paid boolean, created_at timestamptz, pickup_name text,
               departure_time time, bus_number text,
               driver_name text, driver_phone text, driver_changed boolean)
language sql stable security definer set search_path = public as $$
  select b.id, s.id, coalesce(pr.full_name, b.student_name),
         coalesce(r.name, r.start_location), i.name, b.status::text,
         b.is_paid, b.created_at, st.name,
         r.departure_time, v.bus_number,
         coalesce(dc.driver_name, v.driver_name),
         coalesce(dc.driver_phone, v.driver_phone),
         (dc.id is not null)
  from parent_students ps
  join parents pa on pa.id = ps.parent_id and pa.profile_id = auth.uid()
  join students s on s.id = ps.student_id
  join bookings b on b.student_id = s.id
  join routes r on r.id = b.route_id
  left join institutions i on i.id = r.institution_id
  left join vehicles v on v.id = r.vehicle_id
  left join bus_driver_changes dc
    on dc.vehicle_id = v.id and dc.effective_date = (now() at time zone 'Asia/Kolkata')::date
  left join route_stops st on st.id = b.pickup_stop_id
  left join profiles pr on pr.id = s.profile_id
  order by b.created_at desc;
$$;
grant execute on function public.parent_children_bookings() to authenticated;
