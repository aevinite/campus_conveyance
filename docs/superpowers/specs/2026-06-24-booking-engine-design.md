# Campus Conveyance — Slice 2: Booking Engine Design

**Date:** 2026-06-24
**Status:** Approved (design)
**Depends on:** Slice 1 (Foundation) — auth, RBAC, tenant RLS, schema.

---

## Goal

A student can discover their institution's routes, pick pickup/drop stops, see
seat availability, and reserve a seat — with **race-proof** seat accounting —
then view and cancel their bookings.

## Non-goals (deferred)
- Institution-admin CRUD for routes/vehicles/stops (own later slice). Data for
  this slice comes from a seed script.
- Payment gating (Razorpay slice). Bookings confirm immediately here.
- Assigned/numbered seats. Capacity is a per-trip count.

---

## Concurrency model (the critical part)

Seat capacity lives in `seat_allocations(total_seats, reserved_seats)` per
`route_assignment`. Reservation is a single atomic SQL statement inside a
`SECURITY DEFINER` function:

```sql
update seat_allocations
   set reserved_seats = reserved_seats + 1
 where id = v_alloc and reserved_seats < total_seats
returning id;
```

If a row comes back, the seat is secured (`CONFIRMED`); if not, the trip is full
(`WAITLISTED`). This is race-proof under concurrency without app-level locks or
multi-statement transactions. Cancellation decrements atomically
(`reserved_seats = greatest(reserved_seats - 1, 0)`).

Rejected: per-seat rows / SELECT FOR UPDATE — unnecessary for count-based bus
capacity.

---

## Ownership & tenant safety

The reservation/cancel functions are `SECURITY DEFINER` (they bypass RLS), so
they enforce scope internally:
- Derive the student from `auth.uid()` (`students.profile_id = auth.uid()`).
  A user can only book for themselves.
- Verify the route's `institution_id` matches the student's `institution_id`.
- All read paths (list routes, stops, availability, my bookings) go through
  normal RLS, which is already tenant-scoped from Slice 1.

`execute` on both functions is granted to `authenticated` only.

---

## Database (migration 0003)

- `alter table bookings add column seat_allocation_id uuid references seat_allocations(id)`
  — so cancel knows which counter to free.
- `reserve_seat(p_route_id uuid, p_pickup_stop_id uuid, p_drop_stop_id uuid)`
  returns the booking row + status. Logic: resolve student from `auth.uid()`,
  validate same institution, find the route's assignment's seat_allocation,
  atomic increment; insert `bookings` row (`CONFIRMED` + seat_allocation_id, or
  `WAITLISTED`).
- `cancel_booking(p_booking_id uuid)`: verify ownership; if it was `CONFIRMED`
  with a seat_allocation, atomic decrement; set status `CANCELLED`.
- Idempotent (re-runnable); pinned `search_path = public`.

---

## App layer

```
src/features/booking/
  schemas.ts     zod: reserveSchema, cancelSchema
  repository.ts  typed reads: listRoutes, getRouteWithStops, getAvailability, listMyBookings
  services.ts    reserveSeat / cancelBooking (call RPCs), wrap errors
  actions.ts     reserveSeatAction, cancelBookingAction (server actions)
```

UI (student area):
- `/student/routes` — list institution routes (cards).
- `/student/routes/[id]` — stops, pickup/drop selects, live availability,
  Reserve button. Shows result (Confirmed / Waitlisted) via toast.
- `/student/bookings` — my bookings with status + Cancel.
- `/student` dashboard links to both.

---

## Seed (scripts/seed.mjs, service role)

Creates: institution "Demo Institute"; route "Route A" + 3 stops; a vehicle; a
route_assignment; a seat_allocation with a small `total_seats` (e.g. 2, so "full"
is easy to test). Attaches the existing test student (aarav.demo@gmail.com) to
the institution (`profiles.institution_id`) and creates their `students` row.
(Note: institution_id enters the JWT only on next login — re-login after seeding.)

---

## Verification (definition of done)

- `npm run build` + `npm run lint` clean.
- **Concurrency test** (`scripts/test-booking.mjs`): fire N concurrent
  `reserve_seat` calls against a 2-seat allocation; assert exactly 2 `CONFIRMED`,
  rest `WAITLISTED`, and `reserved_seats = 2` (never over). This proves the race
  safety claim.
- Browser: student logs in → browse routes → reserve → see in My Bookings →
  cancel → seat freed.
