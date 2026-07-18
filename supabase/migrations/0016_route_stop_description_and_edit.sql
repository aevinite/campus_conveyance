-- 0016_route_stop_description_and_edit.sql (idempotent)
-- 1) Each pickup stop gets a compulsory description (the exact spot).
-- 2) add_route stores that description; route name = first stop (start location field removed from the form).
-- 3) update_route: edit a route's price/time, and replace its stops when the route has no bookings yet.
alter table route_stops add column if not exists description text;

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

  insert into route_stops (institution_id, route_id, name, sequence, lat, lng, address, description)
  select p_institution_id, v_route.id,
         coalesce(nullif(elem->>'name',''), 'Stop ' || ord::text),
         ord::int,
         (elem->>'lat')::double precision,
         (elem->>'lng')::double precision,
         nullif(elem->>'address',''),
         nullif(elem->>'description','')
  from jsonb_array_elements(coalesce(p_stops, '[]'::jsonb)) with ordinality as t(elem, ord)
  where (elem->>'lat') is not null and (elem->>'lng') is not null;

  return v_route;
end; $$;

-- Edit price/time (always) + replace stops (only when the route has no bookings,
-- since bookings reference route_stops). Returns true if stops were replaced.
create or replace function public.update_route(
  p_route_id uuid, p_price_cents bigint, p_departure_time time, p_stops jsonb default '[]'::jsonb
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_inst uuid; v_has_bookings boolean; v_first text;
begin
  select r.institution_id into v_inst from routes r join agencies a on a.id=r.agency_id
    where r.id=p_route_id and a.owner_profile_id=auth.uid() and a.status='APPROVED';
  if v_inst is null then raise exception 'Not your route' using errcode='P0003'; end if;

  update routes set price_cents=p_price_cents, departure_time=p_departure_time where id=p_route_id;

  select exists(select 1 from bookings where route_id=p_route_id) into v_has_bookings;
  if v_has_bookings then
    return false; -- keep stops (bookings reference them)
  end if;

  delete from route_stops where route_id=p_route_id;
  insert into route_stops (institution_id, route_id, name, sequence, lat, lng, address, description)
  select v_inst, p_route_id,
         coalesce(nullif(elem->>'name',''), 'Stop ' || ord::text),
         ord::int,
         (elem->>'lat')::double precision,
         (elem->>'lng')::double precision,
         nullif(elem->>'address',''),
         nullif(elem->>'description','')
  from jsonb_array_elements(coalesce(p_stops, '[]'::jsonb)) with ordinality as t(elem, ord)
  where (elem->>'lat') is not null and (elem->>'lng') is not null;

  select name into v_first from route_stops where route_id=p_route_id order by sequence limit 1;
  if v_first is not null then
    update routes set name=v_first, start_location=v_first where id=p_route_id;
  end if;
  return true;
end; $$;
