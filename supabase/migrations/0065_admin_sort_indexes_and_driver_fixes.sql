-- 0065_admin_sort_indexes_and_driver_fixes.sql (idempotent)

-- Sort-supporting indexes for the admin Manage Students / Manage Colleges lists,
-- which filter then ORDER BY and otherwise seq-scan + sort at scale.
--   students(): .eq(role).eq(is_deleted).order(full_name)
--   institutions(): .eq(is_deleted).order(name)
create index if not exists idx_profiles_role_deleted_name
  on profiles (role, is_deleted, full_name);
create index if not exists idx_institutions_deleted_name
  on institutions (is_deleted, name);

-- driver_buses' seat sub-selects used `limit 1` with NO ORDER BY, so a route
-- with more than one seat_allocation would return arbitrary seat counts. Pin to
-- the earliest allocation (matches reserve_seat, which orders by created_at).
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
         (select sa.reserved_seats from seat_allocations sa
            join route_assignments ra on ra.id = sa.route_assignment_id
            where ra.route_id = r.id order by sa.created_at limit 1)
  from vehicles v
  left join routes r on r.vehicle_id = v.id
  left join institutions i on i.id = r.institution_id
  where v.id in (select public.driver_today_vehicle_ids())
  order by v.bus_number nulls last, r.departure_time nulls last;
$$;
grant execute on function public.driver_buses() to authenticated;

-- Targeted single-driver lookup (owner-checked) so the agency panel can verify a
-- driver belongs to it — and fetch that driver's login id/email — WITHOUT loading
-- the whole roster via agency_drivers (resolveAgencyDriverId / updateDriverAction).
create or replace function public.agency_driver(p_agency_id uuid, p_driver_id uuid)
returns table (driver_id uuid, profile_id uuid, email text)
language sql stable security definer set search_path = public as $$
  select d.id, d.profile_id, pr.email
  from drivers d
  left join profiles pr on pr.id = d.profile_id
  where d.id = p_driver_id and d.agency_id = p_agency_id
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid())
  limit 1;
$$;
grant execute on function public.agency_driver(uuid, uuid) to authenticated;
