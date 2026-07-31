-- 0106_route_availability_rls_fix.sql (idempotent)
--
-- BUG: the route-detail page over-reported free seats. getAvailability counted
-- live PENDING/CONFIRMED bookings with a PLAIN query running as the signed-in
-- student, but RLS policy bookings_owner_read only lets a student SELECT their
-- OWN bookings — so OTHER students' reservations were invisible and the count
-- came back too low (detail showed 20/20 while the campus list, via the
-- security-definer institution_routes RPC, correctly showed 19/20).
--
-- Fix: count reservations through a SECURITY DEFINER RPC (same oldest-allocation
-- + live PENDING/CONFIRMED logic as institution_routes, 0102), so the detail
-- page sees every reservation and always agrees with the list.

create or replace function public.route_availability(p_route_id uuid)
returns table (total int, reserved int, available int)
language sql stable security definer set search_path = public as $$
  with alloc as (
    -- Same allocation reserve_seat + the campus list use (oldest by created_at).
    select s.id, s.total_seats
    from route_assignments ra
    join seat_allocations s on s.route_assignment_id = ra.id
    where ra.route_id = p_route_id
    order by s.created_at
    limit 1
  ),
  res as (
    select count(*)::int as cnt
    from bookings b
    where b.seat_allocation_id = (select id from alloc)
      and b.status in ('PENDING', 'CONFIRMED')
  )
  select
    coalesce((select total_seats from alloc), 0)::int as total,
    coalesce((select cnt from res), 0)::int as reserved,
    greatest(coalesce((select total_seats from alloc), 0) - coalesce((select cnt from res), 0), 0)::int as available;
$$;
grant execute on function public.route_availability(uuid) to authenticated;
