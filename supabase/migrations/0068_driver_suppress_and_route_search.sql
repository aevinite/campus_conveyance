-- 0068_driver_suppress_and_route_search.sql (idempotent)

-- (1) driver_today_vehicle_ids UNIONed the PERMANENT vehicle unconditionally, so
-- on a day with a DRIVER substitute BOTH the permanent driver and the substitute
-- got the full panel (both could mark stages → duplicate parent notifications;
-- the permanent driver could also toggle "online" though bus_live_location
-- prefers the substitute's GPS). Suppress the permanent vehicle for the day when
-- a DRIVER-role substitute row exists for it — the substitute replaces them.
create or replace function public.driver_today_vehicle_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  with me as (select id from drivers where profile_id = auth.uid())
  select v.id from vehicles v
   where v.driver_id in (select id from me)
     and not exists (
       select 1 from bus_driver_changes dc
        where dc.vehicle_id = v.id
          and dc.role = 'DRIVER'
          and dc.effective_date = (now() at time zone 'Asia/Kolkata')::date
     )
  union
  select dc.vehicle_id from bus_driver_changes dc
   where dc.driver_id in (select id from me)
     and dc.role = 'DRIVER'  -- a CONDUCTOR substitute must NOT get the driver panel
     and dc.effective_date = (now() at time zone 'Asia/Kolkata')::date;
$$;
grant execute on function public.driver_today_vehicle_ids() to authenticated;

-- (3) institution_routes: add search (route/agency name) + vehicle-type filter +
-- limit/offset so the campus-detail page fetches ONE page server-side instead of
-- every route and filtering client-side. Arg list changes → drop first.
drop function if exists public.institution_routes(uuid);
create or replace function public.institution_routes(
  p_institution_id uuid,
  p_query text default null,
  p_vehicle_type text default null,
  p_limit int default null,
  p_offset int default 0
)
returns table (
  id uuid, name text, vehicle_type text, agency_name text,
  bus_number text, is_ac boolean, departure_time time,
  price_cents bigint, total int, available int
) language sql stable security definer set search_path = public as $$
  select r.id, r.name, coalesce(r.vehicle_type::text, 'BUS'),
         a.name, v.bus_number, v.is_ac, r.departure_time, r.price_cents,
         coalesce(seats.total_seats, 0),
         greatest(coalesce(seats.total_seats, 0) - coalesce(seats.reserved_seats, 0), 0)
  from routes r
  left join agencies a on a.id = r.agency_id
  left join vehicles v on v.id = r.vehicle_id
  left join lateral (
    select s.total_seats, s.reserved_seats
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
    and (p_query is null or p_query = ''
         or r.name ilike '%' || p_query || '%'
         or a.name ilike '%' || p_query || '%')
  -- Stable order for pagination (id tiebreaker for equal/absent departure times).
  order by r.departure_time asc nulls last, r.id
  limit p_limit offset coalesce(p_offset, 0);
$$;
grant execute on function public.institution_routes(uuid, text, text, int, int) to authenticated;

create or replace function public.institution_routes_count(
  p_institution_id uuid, p_query text default null, p_vehicle_type text default null
) returns bigint language sql stable security definer set search_path = public as $$
  select count(*)
  from routes r
  left join agencies a on a.id = r.agency_id
  where r.institution_id = p_institution_id
    and r.is_active = true
    and (r.agency_id is null
         or (a.status = 'APPROVED' and coalesce(a.is_deleted, false) = false))
    and (p_vehicle_type is null or r.vehicle_type::text = p_vehicle_type)
    and (p_query is null or p_query = ''
         or r.name ilike '%' || p_query || '%'
         or a.name ilike '%' || p_query || '%');
$$;
grant execute on function public.institution_routes_count(uuid, text, text) to authenticated;
