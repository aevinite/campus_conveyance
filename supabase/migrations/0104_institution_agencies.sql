-- 0104_institution_agencies.sql (idempotent — requires 0102 + 0095)
--
-- Booking flow gains an agency step: campus → AGENCY → bus → reserve. The campus
-- page now lists the agencies serving a school (each with its rating + how many
-- buses/vans it runs there); picking one drills into just that agency's routes.
--
-- 1. institution_agencies(institution) — approved, live agencies that have >=1
--    active route at the campus, plus a synthetic "Campus routes" group for any
--    bookable routes with no agency (seeded routes) so nothing bookable is lost.
-- 2. institution_routes / _count gain p_agency_id + p_orphan_only so the agency
--    page can fetch just that agency's (or the campus-routes) rides. Same body,
--    two new defaulted params → old 5/3-arg named calls keep working.

create or replace function public.institution_agencies(p_institution_id uuid)
returns table (
  id uuid, name text, rating_avg numeric, rating_count int,
  route_count bigint, has_bus boolean, has_van boolean
) language sql stable security definer set search_path = public as $$
  select * from (
    -- Approved, non-deleted agencies with active routes at this campus.
    select a.id, a.name, a.rating_avg, a.rating_count,
           count(r.id)::bigint as route_count,
           bool_or(coalesce(r.vehicle_type::text, 'BUS') = 'BUS') as has_bus,
           bool_or(r.vehicle_type::text = 'VAN') as has_van
    from agencies a
    join routes r on r.agency_id = a.id
    where r.institution_id = p_institution_id
      and r.is_active = true
      and a.status = 'APPROVED' and coalesce(a.is_deleted, false) = false
    group by a.id, a.name, a.rating_avg, a.rating_count
    union all
    -- Fallback bucket for bookable routes not tied to any agency.
    select null::uuid, 'Campus routes'::text, 0::numeric, 0,
           count(*)::bigint,
           bool_or(coalesce(r.vehicle_type::text, 'BUS') = 'BUS'),
           bool_or(r.vehicle_type::text = 'VAN')
    from routes r
    where r.institution_id = p_institution_id
      and r.is_active = true and r.agency_id is null
    having count(*) > 0
  ) t
  order by t.rating_avg desc nulls last, t.name;
$$;
grant execute on function public.institution_agencies(uuid) to authenticated;

-- --- routes list: add agency / orphan filters -----------------------------
drop function if exists public.institution_routes(uuid, text, text, int, int);
create or replace function public.institution_routes(
  p_institution_id uuid,
  p_query text default null,
  p_vehicle_type text default null,
  p_limit int default null,
  p_offset int default 0,
  p_agency_id uuid default null,
  p_orphan_only boolean default false
)
returns table (
  id uuid, name text, vehicle_type text, agency_name text,
  bus_number text, is_ac boolean, departure_time time,
  price_cents bigint, total int, available int
) language sql stable security definer set search_path = public as $$
  select r.id, r.name, coalesce(r.vehicle_type::text, 'BUS'),
         a.name, v.bus_number, v.is_ac, r.departure_time, r.price_cents,
         coalesce(seats.total_seats, 0),
         greatest(coalesce(seats.total_seats, 0) - coalesce(seats.reserved_live, 0), 0)
  from routes r
  left join agencies a on a.id = r.agency_id
  left join vehicles v on v.id = r.vehicle_id
  left join lateral (
    select s.total_seats,
           (select count(*) from bookings b
             where b.seat_allocation_id = s.id
               and b.status in ('PENDING', 'CONFIRMED')) as reserved_live
    from route_assignments ra
    join seat_allocations s on s.route_assignment_id = ra.id
    where ra.route_id = r.id
    order by s.created_at
    limit 1
  ) seats on true
  where r.institution_id = p_institution_id
    and r.is_active = true
    and (r.agency_id is null
         or (a.status = 'APPROVED' and coalesce(a.is_deleted, false) = false))
    and (p_vehicle_type is null or r.vehicle_type::text = p_vehicle_type)
    and (p_agency_id is null or r.agency_id = p_agency_id)
    and (p_orphan_only = false or r.agency_id is null)
    and (p_query is null or p_query = ''
         or r.name ilike '%' || p_query || '%'
         or a.name ilike '%' || p_query || '%')
  order by r.departure_time asc nulls last, r.id
  limit p_limit offset coalesce(p_offset, 0);
$$;
grant execute on function public.institution_routes(uuid, text, text, int, int, uuid, boolean) to authenticated;

drop function if exists public.institution_routes_count(uuid, text, text);
create or replace function public.institution_routes_count(
  p_institution_id uuid, p_query text default null, p_vehicle_type text default null,
  p_agency_id uuid default null, p_orphan_only boolean default false
) returns bigint language sql stable security definer set search_path = public as $$
  select count(*)
  from routes r
  left join agencies a on a.id = r.agency_id
  where r.institution_id = p_institution_id
    and r.is_active = true
    and (r.agency_id is null
         or (a.status = 'APPROVED' and coalesce(a.is_deleted, false) = false))
    and (p_vehicle_type is null or r.vehicle_type::text = p_vehicle_type)
    and (p_agency_id is null or r.agency_id = p_agency_id)
    and (p_orphan_only = false or r.agency_id is null)
    and (p_query is null or p_query = ''
         or r.name ilike '%' || p_query || '%'
         or a.name ilike '%' || p_query || '%');
$$;
grant execute on function public.institution_routes_count(uuid, text, text, uuid, boolean) to authenticated;
