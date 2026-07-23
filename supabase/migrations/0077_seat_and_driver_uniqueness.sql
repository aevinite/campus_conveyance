-- Enforce the "exactly one" invariants the seat + driver code already ASSUMES
-- via `limit 1`, so a stray duplicate (admin tooling, re-run, import) can't split
-- capacity or create two permanent drivers.
--
-- Each block de-dupes conservatively first: it removes only SAFE duplicates
-- (childless rows / extra driver assignments). If two rows BOTH carry live
-- children (e.g. two seat_allocations each with bookings), the de-dupe leaves
-- them and the unique-index creation fails LOUDLY — that means split capacity
-- already exists and must be reconciled by hand, which is the correct signal.

-- ── vehicles(driver_id): a driver is the permanent driver of at most one bus ──
-- Keep one assignment per driver (lowest id), clear driver_id on the rest.
with ranked as (
  select id, row_number() over (partition by driver_id order by id) rn
  from vehicles
  where driver_id is not null
)
update vehicles v set driver_id = null
from ranked r
where v.id = r.id and r.rn > 1;

create unique index if not exists uq_vehicles_driver
  on vehicles(driver_id) where driver_id is not null;

-- ── seat_allocations(route_assignment_id): one allocation per assignment ──
with alloc as (
  select sa.id, sa.route_assignment_id,
         exists (select 1 from bookings b where b.seat_allocation_id = sa.id) as has_bookings
  from seat_allocations sa
),
ranked as (
  select id, has_bookings,
         row_number() over (partition by route_assignment_id order by has_bookings desc, id) rn
  from alloc
)
delete from seat_allocations s
using ranked r
where s.id = r.id and r.rn > 1 and r.has_bookings = false;

create unique index if not exists uq_seat_allocations_assignment
  on seat_allocations(route_assignment_id);

-- ── route_assignments(route_id): one assignment per route ──
with ra as (
  select r.id, r.route_id,
         exists (select 1 from seat_allocations sa where sa.route_assignment_id = r.id) as has_children
  from route_assignments r
),
ranked as (
  select id, has_children,
         row_number() over (partition by route_id order by has_children desc, id) rn
  from ra
)
delete from route_assignments x
using ranked r
where x.id = r.id and r.rn > 1 and r.has_children = false;

create unique index if not exists uq_route_assignments_route
  on route_assignments(route_id);
