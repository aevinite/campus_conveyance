-- 0110_driver_buses_live_seats.sql (idempotent — requires 0065)
--
-- Make the driver panel's seat count use the SAME live PENDING/CONFIRMED count
-- as the rider list (institution_routes) and detail (route_availability), instead
-- of the denormalized seat_allocations.reserved_seats column, so seat numbers can
-- never drift between the driver view and the rider view. Same signature + body
-- as 0065; only seats_reserved changes to a live count on the oldest allocation.

create or replace function public.driver_buses()
returns table (
  vehicle_id uuid, bus_number text, registration_no text, is_ac boolean, capacity int,
  bus_model text, bus_color text, image_url text,
  route_id uuid, route_name text, departure_time time, price_cents bigint,
  college_name text, stops_count bigint, seats_total int, seats_reserved int
) language sql stable security definer set search_path = public as $$
  select v.id, v.bus_number, v.registration_no, v.is_ac, v.capacity,
         v.bus_model, v.bus_color, v.image_url,
         r.id, r.name, r.departure_time, r.price_cents,
         i.name,
         (select count(*) from route_stops rs where rs.route_id = r.id),
         (select sa.total_seats from seat_allocations sa
            join route_assignments ra on ra.id = sa.route_assignment_id
            where ra.route_id = r.id order by sa.created_at limit 1),
         -- LIVE count on the oldest allocation (matches the rider views), not the
         -- denormalized reserved_seats.
         (select count(*)::int from bookings b
            where b.seat_allocation_id = (
              select sa.id from seat_allocations sa
                join route_assignments ra on ra.id = sa.route_assignment_id
                where ra.route_id = r.id order by sa.created_at limit 1)
              and b.status in ('PENDING', 'CONFIRMED'))
  from vehicles v
  left join routes r on r.vehicle_id = v.id
  left join institutions i on i.id = r.institution_id
  where v.id in (select public.driver_today_vehicle_ids())
  order by v.bus_number nulls last, r.departure_time nulls last;
$$;
