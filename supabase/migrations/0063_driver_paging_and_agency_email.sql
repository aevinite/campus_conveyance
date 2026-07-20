-- 0063_driver_paging_and_agency_email.sql (idempotent)

-- (1) agencies.email was looked up with .ilike in ensureEmailFreeForSignup
-- (re-signup cleanup). Small table + registration-only, but mirror profiles
-- (0060): a generated lower(email) column + index turns it into an equality
-- probe and drops the last case-insensitive scan on the signup path.
alter table agencies
  add column if not exists email_lower text generated always as (lower(email)) stored;
create index if not exists idx_agencies_email_lower on agencies (email_lower);

-- (2) driver_buses: revert 0061's `distinct on (v.id)` back to one row PER ROUTE.
-- The distinct-on fixed the dashboard double-count but hid the second route's
-- seat counts for a bus serving two routes. Per-route rows restore accurate
-- seat counts; the app now counts DISTINCT vehicles for "Buses assigned" and
-- keys list rows by vehicle+route (so no duplicate-key / inflated-count bug).
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
  left join routes r on r.vehicle_id = v.id
  left join institutions i on i.id = r.institution_id
  where v.id in (select public.driver_today_vehicle_ids())
  order by v.bus_number nulls last, r.departure_time nulls last;
$$;
grant execute on function public.driver_buses() to authenticated;

-- (3) driver_bookings: the rider roster is CONFIRMED (+PENDING) bookings on the
-- driver's buses, which are never archived → grows across terms. Paginate it
-- (limit/offset), and add a count RPC so the dashboard cards stay accurate
-- without pulling the whole roster. Arg list changes, so drop first.
drop function if exists public.driver_bookings();
create or replace function public.driver_bookings(
  p_limit int default null, p_offset int default 0
)
returns table (
  booking_id uuid, status text, created_at timestamptz,
  student_name text, student_phone text,
  bus_number text, route_name text, pickup_name text, college_name text,
  current_stage text
) language sql stable security definer set search_path = public as $$
  select b.id, b.status::text, b.created_at, pr.full_name, pr.phone,
         v.bus_number, r.name, ps.name, i.name,
         (select re.stage::text from ride_events re
            where re.booking_id = b.id
              and (re.recorded_at at time zone 'Asia/Kolkata')::date
                  = (now() at time zone 'Asia/Kolkata')::date
            order by re.recorded_at desc limit 1)
  from bookings b
  join routes r on r.id = b.route_id
  join vehicles v on v.id = r.vehicle_id
  left join institutions i on i.id = r.institution_id
  left join route_stops ps on ps.id = b.pickup_stop_id
  left join students s on s.id = b.student_id
  left join profiles pr on pr.id = s.profile_id
  where b.status in ('PENDING', 'CONFIRMED')
    and v.id in (select public.driver_today_vehicle_ids())
  order by b.created_at desc
  limit p_limit offset coalesce(p_offset, 0);
$$;
grant execute on function public.driver_bookings(int, int) to authenticated;

create or replace function public.driver_bookings_count()
returns table (total bigint, confirmed bigint)
language sql stable security definer set search_path = public as $$
  select count(*)::bigint,
         count(*) filter (where b.status = 'CONFIRMED')::bigint
  from bookings b
  join routes r on r.id = b.route_id
  join vehicles v on v.id = r.vehicle_id
  where b.status in ('PENDING', 'CONFIRMED')
    and v.id in (select public.driver_today_vehicle_ids());
$$;
grant execute on function public.driver_bookings_count() to authenticated;
