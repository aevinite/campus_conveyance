-- 0102_route_list_live_seats.sql (idempotent — requires 0068 + 0019)
--
-- The campus route list and the route detail page could disagree on "seats
-- available" (e.g. list 19, detail 20) after a seat was freed: the list derived
-- availability from the denormalized seat_allocations.reserved_seats, while the
-- detail page (getAvailability) and reserve_seat count LIVE active bookings. If
-- the denormalized counter ever lagged, the two drifted.
--
-- Fix: the list RPC now counts live PENDING/CONFIRMED bookings on the SAME
-- allocation reserve_seat locks (oldest by created_at), so the list, the detail
-- page and the actual reservation outcome always agree — a freed seat is
-- reflected immediately everywhere. Same signature, so a plain create-or-replace.
-- Also re-reconcile reserved_seats so admin/dashboard occupancy views are exact.

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
         greatest(coalesce(seats.total_seats, 0) - coalesce(seats.reserved_live, 0), 0)
  from routes r
  left join agencies a on a.id = r.agency_id
  left join vehicles v on v.id = r.vehicle_id
  left join lateral (
    -- Same allocation reserve_seat locks (oldest), counted LIVE — no drift.
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
    and (p_query is null or p_query = ''
         or r.name ilike '%' || p_query || '%'
         or a.name ilike '%' || p_query || '%')
  order by r.departure_time asc nulls last, r.id
  limit p_limit offset coalesce(p_offset, 0);
$$;
grant execute on function public.institution_routes(uuid, text, text, int, int) to authenticated;

-- Re-reconcile the denormalized counter for any existing drift (admin/dashboard).
update seat_allocations sa set reserved_seats = (
  select count(*) from bookings b
  where b.seat_allocation_id = sa.id and b.status in ('PENDING', 'CONFIRMED'));
