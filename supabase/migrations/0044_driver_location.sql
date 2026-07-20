-- 0044_driver_location.sql (idempotent)
-- Driver online/offline toggle + live GPS location.
--
-- A driver flips "online" when a trip starts; their phone then streams its GPS
-- position (driver_update_location) so students/parents booked on that bus can
-- watch it move. Going "offline" (e.g. on reaching campus) stops tracking and
-- clears the stored position, so no location is traced when off duty.
--
-- One current-location row per driver. RLS-locked; all access via SECURITY
-- DEFINER RPCs authorized by drivers.profile_id = auth.uid().

create table if not exists driver_locations (
  driver_id uuid primary key references drivers(id) on delete cascade,
  is_online boolean not null default false,
  lat double precision,
  lng double precision,
  updated_at timestamptz not null default now()
);
alter table driver_locations enable row level security;

-- Flip online/offline. Going offline clears the last known position.
create or replace function public.driver_set_online(p_online boolean)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_driver uuid;
begin
  select d.id into v_driver from drivers d where d.profile_id = auth.uid() limit 1;
  if v_driver is null then
    raise exception 'Not a driver account' using errcode = 'P0001';
  end if;
  insert into driver_locations (driver_id, is_online, updated_at)
  values (v_driver, p_online, now())
  on conflict (driver_id) do update set
    is_online = excluded.is_online,
    updated_at = now(),
    lat = case when excluded.is_online then driver_locations.lat else null end,
    lng = case when excluded.is_online then driver_locations.lng else null end;
  return p_online;
end; $$;
grant execute on function public.driver_set_online(boolean) to authenticated;

-- Push the driver's current GPS fix (implicitly marks them online).
create or replace function public.driver_update_location(p_lat double precision, p_lng double precision)
returns void
language plpgsql security definer set search_path = public as $$
declare v_driver uuid;
begin
  select d.id into v_driver from drivers d where d.profile_id = auth.uid() limit 1;
  if v_driver is null then
    raise exception 'Not a driver account' using errcode = 'P0001';
  end if;
  insert into driver_locations (driver_id, is_online, lat, lng, updated_at)
  values (v_driver, true, p_lat, p_lng, now())
  on conflict (driver_id) do update set
    is_online = true, lat = excluded.lat, lng = excluded.lng, updated_at = now();
end; $$;
grant execute on function public.driver_update_location(double precision, double precision) to authenticated;

-- The signed-in driver's own online state (drives the toggle's initial value).
create or replace function public.driver_status()
returns table (is_online boolean, lat double precision, lng double precision, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select coalesce(dl.is_online, false), dl.lat, dl.lng, dl.updated_at
  from drivers d
  left join driver_locations dl on dl.driver_id = d.id
  where d.profile_id = auth.uid()
  limit 1;
$$;
grant execute on function public.driver_status() to authenticated;

-- Live bus location for a route — only readable by a student booked on that
-- route or their linked parent. Coords are returned only while the driver is
-- online AND the last fix is fresh (< 2 minutes), else live = false.
create or replace function public.bus_live_location(p_route_id uuid)
returns table (live boolean, lat double precision, lng double precision,
               updated_at timestamptz, bus_number text)
language sql stable security definer set search_path = public as $$
  select (coalesce(dl.is_online, false) and dl.updated_at > now() - interval '2 minutes') as live,
         case when coalesce(dl.is_online, false) and dl.updated_at > now() - interval '2 minutes'
              then dl.lat end,
         case when coalesce(dl.is_online, false) and dl.updated_at > now() - interval '2 minutes'
              then dl.lng end,
         dl.updated_at, v.bus_number
  from routes r
  join vehicles v on v.id = r.vehicle_id
  join drivers d on d.id = v.driver_id
  left join driver_locations dl on dl.driver_id = d.id
  where r.id = p_route_id
    and (
      exists (
        select 1 from bookings b join students s on s.id = b.student_id
        where b.route_id = p_route_id and s.profile_id = auth.uid()
      )
      or exists (
        select 1 from bookings b
        join students s on s.id = b.student_id
        join parent_students ps on ps.student_id = s.id
        join parents pa on pa.id = ps.parent_id
        where b.route_id = p_route_id and pa.profile_id = auth.uid()
      )
    )
  limit 1;
$$;
grant execute on function public.bus_live_location(uuid) to authenticated;
