-- 0022_driver_panel.sql (idempotent)
-- Link a bus to a driver login account and add driver-panel read RPCs.
-- Drivers have no institution, so RLS hides rows — all reads go via SECURITY
-- DEFINER RPCs scoped to auth.uid() (the driver's profile).
alter table vehicles add column if not exists driver_id uuid references drivers(id) on delete set null;
create index if not exists idx_vehicles_driver on vehicles(driver_id);

-- The signed-in driver's own profile + agency.
create or replace function public.driver_profile()
returns table (
  driver_id uuid, name text, email text, phone text,
  license_no text, is_active boolean, agency_name text
) language sql stable security definer set search_path = public as $$
  select d.id, pr.full_name, pr.email, pr.phone, d.license_no, d.is_active, a.name
  from drivers d
  left join profiles pr on pr.id = d.profile_id
  left join agencies a on a.id = d.agency_id
  where d.profile_id = auth.uid()
  limit 1;
$$;
grant execute on function public.driver_profile() to authenticated;

-- Buses assigned to the driver, with the route/college on each.
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
            where ra.route_id = r.id limit 1),
         (select sa.reserved_seats from seat_allocations sa
            join route_assignments ra on ra.id = sa.route_assignment_id
            where ra.route_id = r.id limit 1)
  from vehicles v
  join drivers d on d.id = v.driver_id and d.profile_id = auth.uid()
  left join routes r on r.vehicle_id = v.id
  left join institutions i on i.id = r.institution_id
  order by v.bus_number nulls last;
$$;
grant execute on function public.driver_buses() to authenticated;

-- Riders (bookings) on the driver's assigned buses — who to pick up, and where.
create or replace function public.driver_bookings()
returns table (
  booking_id uuid, status text, created_at timestamptz,
  student_name text, student_phone text,
  bus_number text, route_name text, pickup_name text, college_name text
) language sql stable security definer set search_path = public as $$
  select b.id, b.status::text, b.created_at, pr.full_name, pr.phone,
         v.bus_number, r.name, ps.name, i.name
  from bookings b
  join routes r on r.id = b.route_id
  join vehicles v on v.id = r.vehicle_id
  join drivers d on d.id = v.driver_id and d.profile_id = auth.uid()
  left join institutions i on i.id = r.institution_id
  left join route_stops ps on ps.id = b.pickup_stop_id
  left join students s on s.id = b.student_id
  left join profiles pr on pr.id = s.profile_id
  where b.status in ('PENDING', 'CONFIRMED')
  order by b.created_at desc;
$$;
grant execute on function public.driver_bookings() to authenticated;
