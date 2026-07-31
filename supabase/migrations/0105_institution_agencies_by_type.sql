-- 0105_institution_agencies_by_type.sql (idempotent — requires 0104)
--
-- The campus page now asks Bus or Van first, then lists the agencies that run
-- THAT vehicle type to the campus (bus companies vs private van operators).
-- Add an optional p_vehicle_type filter to institution_agencies; a null keeps
-- the old "all types" behaviour. Drop+recreate so the single function serves
-- both (named calls omitting p_vehicle_type use the default).

drop function if exists public.institution_agencies(uuid);
create or replace function public.institution_agencies(
  p_institution_id uuid,
  p_vehicle_type text default null
) returns table (
  id uuid, name text, rating_avg numeric, rating_count int,
  route_count bigint, has_bus boolean, has_van boolean
) language sql stable security definer set search_path = public as $$
  select * from (
    -- Approved, non-deleted agencies with active routes of the chosen type here.
    select a.id, a.name, a.rating_avg, a.rating_count,
           count(r.id)::bigint as route_count,
           bool_or(coalesce(r.vehicle_type::text, 'BUS') = 'BUS') as has_bus,
           bool_or(r.vehicle_type::text = 'VAN') as has_van
    from agencies a
    join routes r on r.agency_id = a.id
    where r.institution_id = p_institution_id
      and r.is_active = true
      and a.status = 'APPROVED' and coalesce(a.is_deleted, false) = false
      and (p_vehicle_type is null or coalesce(r.vehicle_type::text, 'BUS') = p_vehicle_type)
    group by a.id, a.name, a.rating_avg, a.rating_count
    union all
    -- Fallback bucket for bookable routes of the chosen type with no agency.
    select null::uuid, 'Campus routes'::text, 0::numeric, 0,
           count(*)::bigint,
           bool_or(coalesce(r.vehicle_type::text, 'BUS') = 'BUS'),
           bool_or(r.vehicle_type::text = 'VAN')
    from routes r
    where r.institution_id = p_institution_id
      and r.is_active = true and r.agency_id is null
      and (p_vehicle_type is null or coalesce(r.vehicle_type::text, 'BUS') = p_vehicle_type)
    having count(*) > 0
  ) t
  order by t.rating_avg desc nulls last, t.name;
$$;
grant execute on function public.institution_agencies(uuid, text) to authenticated;
