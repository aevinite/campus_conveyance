# Admin & Agency Panels — Design Spec

**Date:** 2026-06-25
**Slice:** Admin panel + Agency (Service Provider) panel
**Status:** Approved (pending written-spec review)
**Reference:** `DOC-20260306-WA0001..pdf` Figs 20–38 (rendered in `.pdfpages/`)

## 1. Goal

Build the two remaining actor portals so the marketplace is operable end-to-end:

- **Agency / Service Provider** can apply to join, and once approved, publish a
  transport service at a school/college, add buses and routes, and confirm or
  reject student bookings.
- **Platform Admin (SUPER_ADMIN)** can approve/reject agency applications and
  manage students, agencies, and schools/colleges.

The student/user panel and the race-safe booking engine already exist and are
reused, not rebuilt.

## 2. Approved decisions (from brainstorming)

1. **Booking flow = agency approves.** A reservation is held as `PENDING`
   (seat counts against capacity) until the agency `Confirm`s (→ `CONFIRMED`)
   or `Reject`s (→ `CANCELLED`, seat freed). Supersedes the Slice-2
   instant-confirm behaviour.
2. **Images/files = paste-a-URL.** Every "choose file" in the PDF becomes a URL
   text field. No Supabase Storage bucket needed. Upgrade to real uploads later.
3. **Agency verification = heavy KYC**, applied at the **agency level**:
   company legal name, registration number (CIN/Udyam), GST, PAN, masked
   Aadhaar + document link, transport permit + fitness document links. Per-bus
   document links (RC, permit, fitness, insurance) on the Add-Bus form.
4. **Admin = one seeded SUPER_ADMIN**, separate `/admin` login (Fig 28), no
   public admin sign-up.

### Honest flags carried into the design

- **Aadhaar:** store only `aadhaar_last4` (4 digits) + a document URL. Never the
  full 12-digit number in plaintext (Aadhaar Act exposure). Confirmed acceptable.
- **Drivers:** the PDF has no driver-management screen, so a full drivers/licence
  module is **deferred**. Heavy KYC is satisfied at agency + per-bus level.

## 3. Architecture & approach

Follow existing patterns — no new infrastructure:

- Feature logic under `src/features/agency/*` and `src/features/admin/*`.
- Routes under `src/app/(dashboard)/agency/*`; admin reuses/extends the existing
  `src/app/(dashboard)/super-admin` group, surfaced at `/admin`.
- One new idempotent migration `supabase/migrations/0005_panels.sql`.
- Reuse the amber-on-charcoal dark theme + shadcn (Base UI) components and the
  existing `reserve_seat` / `cancel_booking` booking engine.

Trade-off: extending the existing `agencies`/`vehicles`/`routes` tables (vs a
parallel schema) keeps surface area small and reuses the proven booking engine;
the cost is a handful of nullable columns that only the agency flow populates.

## 4. Data model — migration `0005_panels.sql`

All statements idempotent (`add column if not exists`, `create table if not
exists`, enum guards), matching the style of migrations 0001–0004.

### Enums
- `agency_status` = `PENDING` | `APPROVED` | `REJECTED`.

### `agencies` (extend)
Add: `status agency_status not null default 'PENDING'`,
`is_deleted boolean not null default false`, `deleted_at timestamptz`,
`legal_name text`, `registration_no text` (CIN/Udyam),
`registered_address text`, `aadhaar_last4 text`, `aadhaar_doc_url text`,
`permit_doc_url text`, `fitness_doc_url text`, `approved_at timestamptz`,
`approved_by uuid references profiles(id)`, `rejected_reason text`.
(`name`, `email`, `phone`, `gst_number`, `pan_number`, `description`,
`logo_url`, `owner_profile_id` already exist.)

### `agency_services` (new) — "Service Provider Profile" (Fig 32)
`id uuid pk`, `agency_id uuid not null → agencies`,
`institution_id uuid not null → institutions`, `name text not null`,
`description text`, `image_url text`, `vehicle_type vehicle_type not null
default 'BUS'`, timestamps + `set_updated_at` trigger.
Represents an agency's branded presence at one school/college.

### `vehicles` (extend) — Add Bus (Fig 37)
Add: `agency_service_id uuid → agency_services`, `image_url text`,
`details_pdf_url text`, `rc_url text`, `permit_url text`, `fitness_url text`,
`insurance_url text`. (`capacity`, `registration_no`, `agency_id`,
`vehicle_type` exist.) `registration_no` made nullable for agency-added buses.

### `routes` (extend) — Add Route (Fig 38)
Add: `start_location text`, `image_url text`, `price_cents bigint`,
`departure_time time`, `vehicle_id uuid → vehicles`,
`agency_service_id uuid → agency_services`. End location = existing
`institution_id`. Adding a route also creates a `route_assignment`
(route+vehicle) and a `seat_allocation(total_seats = vehicle.capacity,
reserved_seats = 0)` so it plugs into the existing booking engine.

### `institutions` (extend) — Add College (Fig 26)
Add: `area text`, `city text`.

### `profiles` (extend) — admin student soft-delete
Add: `is_deleted boolean not null default false`, `deleted_at timestamptz`.

### `agency_hidden_students` (new) — per-agency Deleted Students
`agency_id uuid → agencies`, `student_id uuid → students`,
`hidden_at timestamptz default now()`, pk `(agency_id, student_id)`.
Lets an agency hide a student from *its own* list (Restore = delete the row)
without affecting the platform or other agencies.

## 5. Stored procedures (security definer, `search_path = public`)

- `reserve_seat` (modify): insert booking as `PENDING` (not `CONFIRMED`); seat
  still incremented atomically so capacity is honoured while pending. Full =
  `WAITLISTED` (unchanged).
- `confirm_booking(p_booking_id uuid)` (new): caller must own the agency that
  owns the route; `PENDING → CONFIRMED`.
- `reject_booking(p_booking_id uuid)` (new): same ownership check;
  `PENDING → CANCELLED` and decrement `reserved_seats` to free the seat.
- `add_route(...)` (new, optional): atomically insert route + route_assignment +
  seat_allocation. Caller's agency must be `APPROVED`. (May be done as a
  server-action transaction instead; RPC preferred for atomicity.)
- `approve_agency` / `reject_agency` (new): SUPER_ADMIN only; set status +
  `approved_at`/`approved_by` or `rejected_reason`.

Simpler single-table writes (soft delete/restore, add bus, add service, college
CRUD) go through RLS-guarded inserts/updates from server actions, not RPCs.

## 6. RLS

- `agency_services`: public read to authenticated (marketplace browse); write by
  SUPER_ADMIN or the owning agency **and** only when that agency is `APPROVED`.
- `vehicles` / `routes` writes: owning agency must be `APPROVED`; SUPER_ADMIN
  always. Public read already granted in 0004.
- `institutions` write: SUPER_ADMIN only (Add/Manage College). Public read exists.
- `profiles`: add SUPER_ADMIN read/update of all rows for student management;
  soft-deleted students excluded from marketplace-facing reads.
- `agency_hidden_students`: the owning agency only.

## 7. Auth & onboarding

- **Agency sign-up** `/agency/register` (Fig 29): heavy-KYC form → create
  `AGENCY` auth user (role via `raw_user_meta_data.role`, picked up by the
  existing `handle_new_user` trigger) → server action inserts the `agencies`
  row (`status=PENDING`, `owner_profile_id = auth.uid()`). Confirmation screen:
  "awaiting admin approval."
- **Agency login** `/agency/login` (Fig 30). PENDING/REJECTED agencies log in
  but land on a status notice; all write actions blocked (RLS + server-action
  guard), not merely hidden.
- **Admin** `/admin/login` (Fig 28): standard login; route guard requires
  `SUPER_ADMIN`. Seeding: user signs up normally, then runs the provided
  one-line SQL to set `role='SUPER_ADMIN'`.

## 8. Admin panel — `/admin` (Figs 20–27)

Sidebar: Dashboard · Manage Service Provider Requests · Manage Students ·
Deleted Students · Manage Service Providers · Deleted Service Providers ·
Add College · Manage College · Logout.

- **Dashboard:** counts (pending requests, agencies, students, colleges).
- **Requests:** agencies `status=PENDING` → Accept (`approve_agency`) /
  Reject (`reject_agency`). Shows KYC fields for the admin to judge.
- **Manage / Deleted Students:** `profiles` role=STUDENT; soft delete
  (`is_deleted=true`) / restore. Columns: id, name, email, phone.
- **Manage / Deleted Service Providers:** approved agencies; Delete
  (`is_deleted=true`) / Restore. Columns: id, company name, email, phone.
- **Add / Manage College:** CRUD on `institutions` (name, area, city, kind,
  image URL, description); Manage = card grid with Edit/Delete (Fig 27).

## 9. Agency panel — `/agency` (Figs 31–38)

Sidebar: Dashboard · Service Provider Profile · Manage Students ·
Deleted Students · Manage Booking · View Booking · Add Bus · Add Route · Logout.

- **Dashboard:** greeting + counts (services, buses, routes, pending bookings).
- **Service Provider Profile (Fig 32):** create/list `agency_services`
  (transport service name, description, school/college select, image URL).
- **Manage Students (Fig 33):** distinct students who booked this agency's
  routes; Delete = insert into `agency_hidden_students` (and cancel their
  pending/confirmed bookings with this agency, freeing seats).
- **Deleted Students (Fig 34):** rows in `agency_hidden_students`; Restore =
  delete the row.
- **Manage Booking (Fig 35):** this agency's `PENDING` bookings; Confirm /
  Reject via the RPCs. Columns: booking id, student name, email, start–end loc,
  status.
- **View Booking (Fig 36):** read-only list of all this agency's bookings.
- **Add Bus (Fig 37):** capacity, image URL, details-PDF URL, select transport
  service, + heavy-KYC doc URLs (RC, permit, fitness, insurance). Inserts
  `vehicles`.
- **Add Route (Fig 38):** start location, end location (school/college select),
  bus select, image URL, price, departure time → `add_route` creates route +
  assignment + seat allocation.

All write actions require the agency to be `APPROVED`.

## 10. UI / UX

Render all three panels in the existing amber-on-charcoal dark theme with
shadcn (Base UI) components (sidebar shell, themed tables, cards, dialogs for
confirm/reject and edit), rather than the plain white admin tables in the PDF —
same columns and actions, more attractive and consistent across User/Agency/Admin.
Landing role-selector wires the Agency and Admin tiles to `/agency` and `/admin`.

## 11. Student-side ripple

`/student/bookings` now shows a `PENDING` state (awaiting agency confirmation)
distinct from `CONFIRMED`. Route availability already reflects held seats because
`PENDING` increments `reserved_seats`.

## 12. Deliverables you run (no DB connection from me)

1. `supabase/migrations/0005_panels.sql` — run in your Supabase SQL editor.
2. A one-line SQL snippet to promote your account to `SUPER_ADMIN` (provided in
   the run list at the end).

Run order: 0001 → 0002 → 0003 → 0004 → **0005**, then the admin-promote line.

## 13. Out of scope (deferred)

- Real file uploads / Supabase Storage.
- Payments (Razorpay) before booking confirm.
- Drivers / driver-licence KYC and GPS/attendance.
- Full Aadhaar number storage (only last-4 + doc link kept).

## 14. Build order

1. Migration `0005`.
2. Booking model change (`reserve_seat` PENDING + confirm/reject RPCs) and
   student-side pending display.
3. Agency onboarding (register/login) + status gating.
4. Admin panel (seeded login, requests, students, providers, colleges).
5. Agency panel (profile, add bus, add route, bookings, students).
6. Landing role-selector wiring + end-to-end verification.
