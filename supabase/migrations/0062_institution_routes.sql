-- 0062_institution_routes.sql (idempotent)
-- listInstitutionRoutes fetched EVERY active route for a campus and then dropped
-- the routes of suspended / soft-deleted agencies in JS. Do the visibility
-- filter (and the seat roll-up) in SQL instead, so suspended-agency routes never
-- leave the database. Seeded routes have no agency (agency_id is null) and stay
-- bookable — an inner join couldn't express that, hence this RPC.
create or replace function public.institution_routes(p_institution_id uuid)
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
    -- No agency (seeded route) → bookable; otherwise the agency must be live.
    and (r.agency_id is null
         or (a.status = 'APPROVED' and coalesce(a.is_deleted, false) = false))
  order by r.departure_time asc nulls last;
$$;
grant execute on function public.institution_routes(uuid) to authenticated;
