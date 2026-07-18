-- 0015_route_stops_map.sql (idempotent)
-- Pickup stops with exact map coordinates. route_stops already has lat/lng; add a
-- human-readable address. add_route now also inserts the stops (name + lat/lng +
-- address + sequence) in the same SECURITY DEFINER call, so no route-link field
-- is needed and stops are created atomically with the route.
alter table route_stops add column if not exists address text;

-- Replace add_route with a version that accepts a JSON array of stops.
drop function if exists public.add_route(uuid, uuid, uuid, uuid, text, bigint, time, text);

create or replace function public.add_route(
  p_agency_id uuid, p_agency_service_id uuid, p_institution_id uuid,
  p_vehicle_id uuid, p_start_location text, p_price_cents bigint,
  p_departure_time time, p_image_url text, p_stops jsonb default '[]'::jsonb
) returns routes language plpgsql security definer set search_path = public as $$
declare v_route routes; v_cap int; v_ra uuid; v_vtype vehicle_type;
begin
  if not exists (select 1 from agencies where id=p_agency_id and owner_profile_id=auth.uid() and status='APPROVED') then
    raise exception 'Agency not approved' using errcode='P0003'; end if;
  select capacity, vehicle_type into v_cap, v_vtype from vehicles where id=p_vehicle_id and agency_id=p_agency_id;
  if v_cap is null then raise exception 'Bus not found' using errcode='P0002'; end if;

  insert into routes (institution_id, agency_id, agency_service_id, vehicle_id, vehicle_type,
    name, start_location, price_cents, departure_time, image_url, is_active)
  values (p_institution_id, p_agency_id, p_agency_service_id, p_vehicle_id, v_vtype,
    coalesce(nullif(p_start_location,''),'Route'), p_start_location, p_price_cents, p_departure_time, p_image_url, true)
  returning * into v_route;

  insert into route_assignments (institution_id, route_id, vehicle_id)
  values (p_institution_id, v_route.id, p_vehicle_id) returning id into v_ra;
  insert into seat_allocations (institution_id, route_assignment_id, total_seats, reserved_seats)
  values (p_institution_id, v_ra, v_cap, 0);

  -- Pickup stops (in order). Skip any without valid coordinates.
  insert into route_stops (institution_id, route_id, name, sequence, lat, lng, address)
  select p_institution_id, v_route.id,
         coalesce(nullif(elem->>'name',''), 'Stop ' || ord::text),
         ord::int,
         (elem->>'lat')::double precision,
         (elem->>'lng')::double precision,
         nullif(elem->>'address','')
  from jsonb_array_elements(coalesce(p_stops, '[]'::jsonb)) with ordinality as t(elem, ord)
  where (elem->>'lat') is not null and (elem->>'lng') is not null;

  return v_route;
end; $$;
