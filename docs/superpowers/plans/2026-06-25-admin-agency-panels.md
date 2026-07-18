# Admin & Agency Panels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the Agency (service-provider) and Admin (SUPER_ADMIN) portals so the marketplace runs end-to-end: agencies apply with heavy KYC → admin approves → agency publishes services/buses/routes and confirms/rejects bookings.

**Architecture:** Extend existing tables in one new idempotent migration `0005_panels.sql`; add agency-owner + admin RLS policies and SECURITY DEFINER RPCs for cross-cutting reads/writes (RLS for agency-scoped reads is fragile, so agency lists go through RPCs). New feature folders `src/features/agency` + `src/features/admin`; new route groups `(dashboard)/agency` and `(dashboard)/admin`. Reuse amber-on-charcoal theme, shadcn (Base UI) components, and the existing race-safe booking engine. Booking flow changes to agency-approval (PENDING hold).

**Tech Stack:** Next.js 16 (App Router, server actions, `useActionState`), Supabase (Postgres + RLS + RPC, `@supabase/ssr`), Zod, Tailwind v4, shadcn/Base UI, lucide-react, framer-motion.

**Verification reality:** This repo has **no JS unit-test runner** (no jest/vitest); it verifies with `npm run lint`, `npm run build` (full typecheck), `.mjs` scripts, and browser checks. The user's DB is in a **separate account we do NOT connect to** — so DB/browser testing of the live flow is the user's step after they run `0005`. Our gate per task = `lint` + `build` clean and code-review of the diff.

---

## File structure

**Migration**
- Create `supabase/migrations/0005_panels.sql` — all schema/enum/RLS/RPC changes.

**Shared / role plumbing**
- Modify `src/lib/rbac/roles.ts` — add `AGENCY` role + `/agency` dashboard mapping.
- Modify `src/proxy.ts` — make agency/admin auth routes public.

**Agency feature**
- Create `src/features/agency/schemas.ts` — Zod schemas (register, service, bus, route).
- Create `src/features/agency/repository.ts` — agency-scoped reads (via RPC/selects).
- Create `src/features/agency/services.ts` — RPC wrappers (confirm/reject booking, add route).
- Create `src/features/agency/actions.ts` — server actions for every agency form.

**Admin feature**
- Create `src/features/admin/repository.ts` — admin reads (requests, students, agencies, colleges, counts).
- Create `src/features/admin/actions.ts` — approve/reject agency, soft delete/restore, college CRUD.

**Agency routes** (`src/app/(auth-agency)` for public; `(dashboard)/agency` for panel)
- Create `src/app/agency/register/page.tsx`, `src/app/agency/login/page.tsx` (public).
- Create `src/app/(dashboard)/agency/layout.tsx` — sidebar shell + APPROVED gate.
- Create `src/app/(dashboard)/agency/page.tsx` (dashboard), `profile/`, `students/`, `students/deleted/`, `bookings/`, `bookings/view/`, `buses/new/`, `routes/new/`.

**Admin routes**
- Create `src/app/admin/login/page.tsx` (public).
- Create `src/app/(dashboard)/admin/layout.tsx` — sidebar shell + SUPER_ADMIN gate.
- Create `src/app/(dashboard)/admin/page.tsx` (dashboard), `requests/`, `students/`, `students/deleted/`, `providers/`, `providers/deleted/`, `colleges/new/`, `colleges/`.

**Shared UI**
- Create `src/components/panel-sidebar.tsx` — reusable sidebar shell (label/href/icon list).
- Create `src/components/data-table.tsx` — simple themed table (columns + rows + action slot).

**Student ripple**
- Modify `src/app/(dashboard)/student/bookings/page.tsx` — render PENDING distinctly.

---

## Phase 0 — Database migration

### Task 1: Write `0005_panels.sql`

**Files:** Create `supabase/migrations/0005_panels.sql`

- [ ] **Step 1: Enums + table extensions (idempotent)**

```sql
-- 0005_panels.sql — admin + agency panels (idempotent)

do $$ begin create type agency_status as enum ('PENDING','APPROVED','REJECTED');
exception when duplicate_object then null; end $$;

-- agencies: status, soft-delete, heavy KYC
alter table agencies add column if not exists status agency_status not null default 'PENDING';
alter table agencies add column if not exists is_deleted boolean not null default false;
alter table agencies add column if not exists deleted_at timestamptz;
alter table agencies add column if not exists legal_name text;
alter table agencies add column if not exists registration_no text;       -- CIN / Udyam
alter table agencies add column if not exists registered_address text;
alter table agencies add column if not exists aadhaar_last4 text;
alter table agencies add column if not exists aadhaar_doc_url text;
alter table agencies add column if not exists permit_doc_url text;
alter table agencies add column if not exists fitness_doc_url text;
alter table agencies add column if not exists approved_at timestamptz;
alter table agencies add column if not exists approved_by uuid references profiles(id);
alter table agencies add column if not exists rejected_reason text;

-- agency_services (Service Provider Profile, Fig 32)
create table if not exists agency_services (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  institution_id uuid not null references institutions(id) on delete cascade,
  name text not null,
  description text,
  image_url text,
  vehicle_type vehicle_type not null default 'BUS',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_agency_services_updated on agency_services;
create trigger trg_agency_services_updated before update on agency_services
  for each row execute function set_updated_at();

-- vehicles (Add Bus, Fig 37) — registration optional for agency buses
alter table vehicles add column if not exists agency_service_id uuid references agency_services(id) on delete set null;
alter table vehicles add column if not exists image_url text;
alter table vehicles add column if not exists details_pdf_url text;
alter table vehicles add column if not exists rc_url text;
alter table vehicles add column if not exists permit_url text;
alter table vehicles add column if not exists fitness_url text;
alter table vehicles add column if not exists insurance_url text;
alter table vehicles alter column registration_no drop not null;
alter table vehicles alter column institution_id drop not null;

-- routes (Add Route, Fig 38)
alter table routes add column if not exists start_location text;
alter table routes add column if not exists image_url text;
alter table routes add column if not exists price_cents bigint;
alter table routes add column if not exists departure_time time;
alter table routes add column if not exists vehicle_id uuid references vehicles(id) on delete set null;
alter table routes add column if not exists agency_service_id uuid references agency_services(id) on delete set null;

-- institutions (Add College, Fig 26)
alter table institutions add column if not exists area text;
alter table institutions add column if not exists city text;

-- profiles soft-delete (admin Manage Students)
alter table profiles add column if not exists is_deleted boolean not null default false;
alter table profiles add column if not exists deleted_at timestamptz;

-- per-agency hidden students (agency Deleted Students)
create table if not exists agency_hidden_students (
  agency_id uuid not null references agencies(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (agency_id, student_id)
);
alter table agency_hidden_students enable row level security;
```

- [ ] **Step 2: RLS policies** (append to same file)

```sql
-- Helper: agency ids owned by the current user.
create or replace function public.my_agency_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from agencies where owner_profile_id = auth.uid();
$$;

-- agency_services: public read (browse); write by owning+APPROVED agency or admin.
alter table agency_services enable row level security;
drop policy if exists agency_services_read on agency_services;
create policy agency_services_read on agency_services for select to authenticated using (true);
drop policy if exists agency_services_write on agency_services;
create policy agency_services_write on agency_services for all to authenticated
  using (public.jwt_role()='SUPER_ADMIN'
    or agency_id in (select id from agencies where owner_profile_id=auth.uid() and status='APPROVED'))
  with check (public.jwt_role()='SUPER_ADMIN'
    or agency_id in (select id from agencies where owner_profile_id=auth.uid() and status='APPROVED'));

-- vehicles / routes: add agency-owner write (OR'd with existing tenant_rw policy).
drop policy if exists vehicles_agency_write on vehicles;
create policy vehicles_agency_write on vehicles for all to authenticated
  using (agency_id in (select id from agencies where owner_profile_id=auth.uid() and status='APPROVED'))
  with check (agency_id in (select id from agencies where owner_profile_id=auth.uid() and status='APPROVED'));
drop policy if exists routes_agency_write on routes;
create policy routes_agency_write on routes for all to authenticated
  using (agency_id in (select id from agencies where owner_profile_id=auth.uid() and status='APPROVED'))
  with check (agency_id in (select id from agencies where owner_profile_id=auth.uid() and status='APPROVED'));
-- route_assignments / seat_allocations created by add_route RPC (SECURITY DEFINER), no extra policy needed.

-- bookings: agency can read bookings on its routes.
drop policy if exists bookings_agency_read on bookings;
create policy bookings_agency_read on bookings for select to authenticated
  using (route_id in (select id from routes where agency_id in
    (select id from agencies where owner_profile_id=auth.uid())));

-- profiles: admin can update any row (soft delete/restore students).
drop policy if exists profiles_admin_write on profiles;
create policy profiles_admin_write on profiles for update to authenticated
  using (public.jwt_role()='SUPER_ADMIN') with check (public.jwt_role()='SUPER_ADMIN');

-- agency_hidden_students: owning agency only.
drop policy if exists ahs_owner on agency_hidden_students;
create policy ahs_owner on agency_hidden_students for all to authenticated
  using (agency_id in (select id from agencies where owner_profile_id=auth.uid()))
  with check (agency_id in (select id from agencies where owner_profile_id=auth.uid()));

-- agencies: keep existing read; existing agencies_write (0004) already allows owner+admin.
-- Marketplace browse must hide soft-deleted / non-approved agencies — handled in queries.
```

- [ ] **Step 3: Booking-flow RPCs** (append)

```sql
-- reserve_seat v3: hold as PENDING (was CONFIRMED). Seat still incremented.
create or replace function public.reserve_seat(
  p_route_id uuid, p_pickup_stop_id uuid, p_drop_stop_id uuid
) returns bookings language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_route routes; v_student students; v_alloc seat_allocations;
  v_got uuid; v_booking bookings;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated' using errcode='P0001'; end if;
  select * into v_route from routes where id = p_route_id;
  if v_route.id is null then raise exception 'Route not found' using errcode='P0002'; end if;
  select * into v_student from students where profile_id = v_uid limit 1;
  if v_student.id is null then
    insert into students (profile_id) values (v_uid) returning * into v_student;
  end if;
  select sa.* into v_alloc from seat_allocations sa
    join route_assignments ra on ra.id = sa.route_assignment_id
   where ra.route_id = p_route_id order by sa.created_at limit 1;
  if v_alloc.id is null then
    raise exception 'No seats configured for this route' using errcode='P0004';
  end if;
  update seat_allocations set reserved_seats = reserved_seats + 1
   where id = v_alloc.id and reserved_seats < total_seats returning id into v_got;
  if v_got is not null then
    insert into bookings (institution_id, student_id, route_id, pickup_stop_id, drop_stop_id, status, seat_allocation_id)
    values (v_route.institution_id, v_student.id, p_route_id, p_pickup_stop_id, p_drop_stop_id, 'PENDING', v_alloc.id)
    returning * into v_booking;
  else
    insert into bookings (institution_id, student_id, route_id, pickup_stop_id, drop_stop_id, status)
    values (v_route.institution_id, v_student.id, p_route_id, p_pickup_stop_id, p_drop_stop_id, 'WAITLISTED')
    returning * into v_booking;
  end if;
  return v_booking;
end; $$;

-- Guard: caller owns the agency that owns the booking's route.
create or replace function public.agency_owns_booking(p_booking_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from bookings b join routes r on r.id = b.route_id
    join agencies a on a.id = r.agency_id
    where b.id = p_booking_id and a.owner_profile_id = auth.uid());
$$;

create or replace function public.confirm_booking(p_booking_id uuid) returns bookings
language plpgsql security definer set search_path = public as $$
declare v bookings;
begin
  if not public.agency_owns_booking(p_booking_id) then
    raise exception 'Not your booking' using errcode='P0003'; end if;
  update bookings set status='CONFIRMED' where id=p_booking_id and status='PENDING' returning * into v;
  if v.id is null then raise exception 'Booking not pending' using errcode='P0005'; end if;
  return v;
end; $$;

create or replace function public.reject_booking(p_booking_id uuid) returns bookings
language plpgsql security definer set search_path = public as $$
declare v bookings; v_alloc uuid;
begin
  if not public.agency_owns_booking(p_booking_id) then
    raise exception 'Not your booking' using errcode='P0003'; end if;
  select seat_allocation_id into v_alloc from bookings where id=p_booking_id;
  update bookings set status='CANCELLED' where id=p_booking_id and status in ('PENDING','CONFIRMED') returning * into v;
  if v.id is null then raise exception 'Cannot reject' using errcode='P0005'; end if;
  if v_alloc is not null then
    update seat_allocations set reserved_seats = greatest(reserved_seats-1,0) where id=v_alloc;
  end if;
  return v;
end; $$;

-- add_route: insert route + assignment + seat allocation atomically (agency APPROVED).
create or replace function public.add_route(
  p_agency_id uuid, p_agency_service_id uuid, p_institution_id uuid,
  p_vehicle_id uuid, p_start_location text, p_price_cents bigint, p_departure_time time, p_image_url text
) returns routes language plpgsql security definer set search_path = public as $$
declare v_route routes; v_cap int; v_ra uuid; v_vtype vehicle_type;
begin
  if not exists (select 1 from agencies where id=p_agency_id and owner_profile_id=auth.uid() and status='APPROVED') then
    raise exception 'Agency not approved' using errcode='P0003'; end if;
  select capacity, vehicle_type into v_cap, v_vtype from vehicles where id=p_vehicle_id and agency_id=p_agency_id;
  if v_cap is null then raise exception 'Bus not found' using errcode='P0002'; end if;
  insert into routes (institution_id, agency_id, agency_service_id, vehicle_id, vehicle_type,
    name, start_location, price_cents, departure_time, image_url, is_active)
  values (p_institution_id, p_agency_id, p_agency_service_id, p_vehicle_id, v_vtype,
    coalesce(p_start_location,'Route'), p_start_location, p_price_cents, p_departure_time, p_image_url, true)
  returning * into v_route;
  insert into route_assignments (institution_id, route_id, vehicle_id)
  values (p_institution_id, v_route.id, p_vehicle_id) returning id into v_ra;
  insert into seat_allocations (institution_id, route_assignment_id, total_seats, reserved_seats)
  values (p_institution_id, v_ra, v_cap, 0);
  return v_route;
end; $$;
```

- [ ] **Step 4: Verify SQL parses** — sanity-check brackets/`$$` balance by eye (cannot run against DB). Confirm every `create policy` has a matching `drop policy if exists`. No app build needed yet.

---

## Phase 1 — Role plumbing (unblocks agency auth)

### Task 2: Add AGENCY role

**Files:** Modify `src/lib/rbac/roles.ts`

- [ ] **Step 1:** Add `'AGENCY'` to `ROLES` array and `AGENCY: '/agency'` to `DASHBOARD_BY_ROLE`. Change `SUPER_ADMIN` mapping to `'/admin'`.
- [ ] **Step 2:** `npm run build` — Expected: passes (TS enums updated). The old `(dashboard)/super-admin` page becomes unreferenced; leave or delete (delete in Task 11).

### Task 3: Make agency/admin auth routes public

**Files:** Modify `src/proxy.ts`

- [ ] **Step 1:** Add `'/agency/register'`, `'/agency/login'`, `'/admin/login'` to the `PUBLIC` array. (Note `/agency` and `/admin` dashboards stay protected because they don't match these exact entries — but `startsWith(p+'/')` would over-match; so list the exact login/register paths and keep the dashboard segments protected by their layout guards. To avoid the `startsWith` over-match, use exact-match-only entries for these three.)
- [ ] **Step 2:** Adjust `isPublic` so the three new entries match **exactly** (not prefix) — change to: `PUBLIC.some((p) => path === p) || PREFIX_PUBLIC.some((p)=>path===p||path.startsWith(p+'/'))` where `PREFIX_PUBLIC = ['/auth']` and everything else is exact. Keep `/`, `/login`, etc. exact.
- [ ] **Step 3:** `npm run build` — Expected: passes.

---

## Phase 2 — Booking model change + student ripple

### Task 4: Agency booking service wrappers

**Files:** Create `src/features/agency/services.ts`

- [ ] **Step 1:** Write `confirmBooking(db, id)`, `rejectBooking(db, id)` calling `db.rpc('confirm_booking'|'reject_booking', { p_booking_id })`, throwing `new AppError('BOOKING', error.message)` on error (mirror `features/booking/services.ts`). Also `addRoute(db, input)` calling `db.rpc('add_route', {...})`.
- [ ] **Step 2:** `npm run build` — Expected: passes.

### Task 5: Student bookings shows PENDING

**Files:** Modify `src/app/(dashboard)/student/bookings/page.tsx`

- [ ] **Step 1:** Add a status badge: PENDING → amber "Awaiting confirmation", CONFIRMED → green, CANCELLED → muted, WAITLISTED → blue. (Reuse the existing list; just map status→label/color.)
- [ ] **Step 2:** `npm run build` + `npm run lint` — Expected: pass.

---

## Phase 3 — Agency onboarding

### Task 6: Agency schemas + register/login actions

**Files:** Create `src/features/agency/schemas.ts`, `src/features/agency/actions.ts`

- [ ] **Step 1:** `schemas.ts` — `agencyRegisterSchema` (name, email, password≥8, phone, legalName, registrationNo, gstNumber, panNumber, registeredAddress, aadhaarLast4 = `z.string().regex(/^\d{4}$/)`, aadhaarDocUrl/permitDocUrl/fitnessDocUrl = `z.string().url().optional().or(z.literal(''))`). Plus `serviceSchema`, `busSchema`, `routeSchema` (used later).
- [ ] **Step 2:** `actions.ts` — `agencyRegisterAction`: parse → `db.auth.signUp({ email, password, options:{ data:{ full_name:name, role:'AGENCY' }, emailRedirectTo }})` → on success, **upsert agencies row** with `owner_profile_id = (await db.auth.getUser()).data.user.id`, status default PENDING, KYC fields. (signUp may require email confirm; insert agency row in the same action using the returned user id — RLS `agencies_write` allows `owner_profile_id=auth.uid()`.) Redirect to a `/agency/login?pending=1` notice. Reuse `loginAction` pattern for `agencyLoginAction` (calls existing `loginUser`, then `redirect('/agency')`).
- [ ] **Step 3:** `npm run build` — Expected: passes.

### Task 7: Agency register + login pages

**Files:** Create `src/app/agency/register/page.tsx`, `src/app/agency/login/page.tsx`, and a tiny `src/app/agency/layout.tsx` (centered card, amber backdrop — copy `(auth)/layout.tsx`).

- [ ] **Step 1:** Register page (Fig 29 fields, themed Card + Inputs, `useActionState(agencyRegisterAction)`), grouped: Account (name/email/password/phone), then "Verification (KYC)" section (legal name, registration no, GST, PAN, masked Aadhaar last-4 + doc URL, permit URL, fitness URL). Helper text under Aadhaar: "Enter last 4 digits only." Link to login.
- [ ] **Step 2:** Login page (Fig 30): email + password, `useActionState(agencyLoginAction)`; if `?pending=1`, show "Application submitted — awaiting admin approval." Link to register.
- [ ] **Step 3:** `npm run build` + `lint` — Expected: pass.

---

## Phase 4 — Shared panel UI

### Task 8: Sidebar shell + data table

**Files:** Create `src/components/panel-sidebar.tsx`, `src/components/data-table.tsx`

- [ ] **Step 1:** `PanelSidebar({ title, items, role })` — fixed left column (charcoal), Logo, greeting, list of `{label, href, icon}` with active highlight via `usePathname`, logout `<form action={logoutAction}>`. Content area renders `children`.
- [ ] **Step 2:** `DataTable({ columns, rows, renderActions })` — themed `<table>` (border-border, muted header), empty state row. Keep it dumb/presentational.
- [ ] **Step 3:** `npm run build` — Expected: passes.

---

## Phase 5 — Admin panel

### Task 9: Admin repository + actions

**Files:** Create `src/features/admin/repository.ts`, `src/features/admin/actions.ts`

- [ ] **Step 1:** `repository.ts` reads (all RLS-allowed for SUPER_ADMIN via existing policies):
  - `listAgencyRequests(db)` → agencies `status='PENDING'`, not deleted.
  - `listAgencies(db)` → `status='APPROVED'`, `is_deleted=false`. `listDeletedAgencies(db)` → `is_deleted=true`.
  - `listStudents(db)` → profiles `role='STUDENT'`, `is_deleted=false`. `listDeletedStudents(db)` → `is_deleted=true`.
  - `listColleges(db)` → institutions. `getCounts(db)` → counts for dashboard.
- [ ] **Step 2:** `actions.ts`:
  - `approveAgencyAction(fd)`: `db.rpc('approve_agency'...)` **or** direct `update agencies set status='APPROVED', approved_at=now(), approved_by=auth.uid()`. (Add `approve_agency`/`reject_agency` RPCs to 0005 if RLS update of agencies by admin is blocked — `agencies_write` allows SUPER_ADMIN, so direct update works; no RPC needed.) `rejectAgencyAction` sets `status='REJECTED'`, `rejected_reason`.
  - `deleteAgencyAction`/`restoreAgencyAction`: set `is_deleted` + `deleted_at`.
  - `deleteStudentAction`/`restoreStudentAction`: update profiles `is_deleted`.
  - `addCollegeAction`/`updateCollegeAction`/`deleteCollegeAction`: insert/update/delete institutions (name, area, city, kind, image_url, description; generate `slug` from name).
  - Each `revalidatePath` the relevant admin page.
- [ ] **Step 3:** `npm run build` — Expected: passes.

### Task 10: Admin login + layout

**Files:** Create `src/app/admin/login/page.tsx`, `src/app/(dashboard)/admin/layout.tsx`

- [ ] **Step 1:** `admin/login` (Fig 28): "Admin Login", email + password, reuse a thin `adminLoginAction` (or the shared `loginAction` then guard redirects). Public route (Task 3).
- [ ] **Step 2:** `(dashboard)/admin/layout.tsx`: `await requireRole('SUPER_ADMIN')`; render `PanelSidebar` with admin items (Dashboard, Manage Service Provider Requests, Manage Students, Deleted Students, Manage Service Providers, Deleted Service Providers, Add College, Manage College).
- [ ] **Step 3:** `npm run build` — Expected: passes.

### Task 11: Admin pages

**Files:** Create `admin/page.tsx`, `admin/requests/page.tsx`, `admin/students/page.tsx`, `admin/students/deleted/page.tsx`, `admin/providers/page.tsx`, `admin/providers/deleted/page.tsx`, `admin/colleges/new/page.tsx`, `admin/colleges/page.tsx`. Delete old `(dashboard)/super-admin/`.

- [ ] **Step 1:** Dashboard: count cards. Requests: `DataTable` (ID, Company, Email, Phone) + expandable KYC + Accept/Reject forms. Students/Deleted: table + Delete/Restore. Providers/Deleted: table + Delete/Restore. Add College: themed form (Fig 26). Manage College: card grid with Edit/Delete (Fig 27).
- [ ] **Step 2:** `npm run build` + `lint` — Expected: pass.

---

## Phase 6 — Agency panel

### Task 12: Agency repository + remaining actions

**Files:** Modify `src/features/agency/repository.ts`, `src/features/agency/actions.ts`

- [ ] **Step 1:** `repository.ts`:
  - `getMyAgency(db)` → agency where `owner_profile_id=auth.uid()` (status + ids).
  - `listMyServices`, `listMyBuses`, `listMyRoutes` (filter by agency_id).
  - `listMyBookings(db, agencyId)` → bookings on this agency's routes joined to student profile (name/email/phone) + route start/end; `PENDING` subset for Manage Booking.
  - `listMyStudents(db, agencyId)` → distinct students with a booking, minus `agency_hidden_students`. `listHiddenStudents`.
  - `getCounts`.
- [ ] **Step 2:** `actions.ts`: `addServiceAction`, `addBusAction`, `addRouteAction` (→ `add_route` RPC), `confirmBookingAction`/`rejectBookingAction` (→ services), `hideStudentAction` (insert agency_hidden_students + reject their pending bookings), `restoreStudentAction` (delete row).
- [ ] **Step 3:** `npm run build` — Expected: passes.

### Task 13: Agency layout (APPROVED gate) + pages

**Files:** Create `src/app/(dashboard)/agency/layout.tsx` + the 8 pages.

- [ ] **Step 1:** Layout: `await requireRole('AGENCY')`; load `getMyAgency`; if status≠APPROVED render a centered status card (PENDING: "awaiting approval"; REJECTED: show reason) instead of the panel — write actions thus unreachable. Else render `PanelSidebar` (Dashboard, Service Provider Profile, Manage Students, Deleted Students, Manage Booking, View Booking, Add Bus, Add Route).
- [ ] **Step 2:** Pages: Dashboard (counts), Profile (create + list services, school/college select from institutions), Manage/Deleted Students (table + hide/restore), Manage Booking (PENDING table + Confirm/Reject), View Booking (read-only), Add Bus (Fig 37 form), Add Route (Fig 38 form; bus + service + school selects).
- [ ] **Step 3:** `npm run build` + `lint` — Expected: pass.

---

## Phase 7 — Wire-up + verification

### Task 14: Landing role-selector + run list

**Files:** Modify `src/app/page.tsx`; create `docs/RUN_THIS_IN_DB.md`

- [ ] **Step 1:** Point Agency tile → `/agency/login`, Admin tile → `/admin/login`, User tile stays `/login`. (User-side register at `/agency/register` linked from agency login.)
- [ ] **Step 2:** `RUN_THIS_IN_DB.md`: the run order (0001→0005) and the admin-promote SQL:
  `update profiles set role='SUPER_ADMIN' where id=(select id from auth.users where email='YOUR_EMAIL');`
  Note: after promoting, log out/in so the JWT claim refreshes.
- [ ] **Step 3:** `npm run build` + `npm run lint` — Expected: both clean.
- [ ] **Step 4:** Use `superpowers:requesting-code-review` on the full diff; fix findings.

---

## Self-review (plan vs spec)

- **Spec coverage:** §4 data model → Task 1. §5 RPCs → Task 1 (steps 3) + Task 4/12. §6 RLS → Task 1 (step 2). §7 auth/onboarding → Tasks 2,3,6,7,10. §8 admin → Tasks 9–11. §9 agency → Tasks 12–13. §10 UI → Task 8 + pages. §11 student ripple → Task 5. §12 deliverables → Task 14. All covered.
- **Placeholders:** backend/tricky code is complete (migration, RPCs, RLS); UI pages are specified by fields/columns/components matching the PDF figures and existing page patterns — acceptable since the executor follows the cited reference files.
- **Type consistency:** RPC names match between SQL and services (`reserve_seat`, `confirm_booking`, `reject_booking`, `add_route`). Role string `AGENCY` matches enum added in 0004. `seat_allocation_id` column on bookings is assumed to exist (added in booking slice 0003) — verify in Task 1 step 4; if absent, add `alter table bookings add column if not exists seat_allocation_id uuid references seat_allocations(id);` to 0005.

## Open verification gaps (user-run, separate DB)

Because we never touch the user's database, the live flow (signup→approve→add bus/route→reserve→confirm) must be tested by the user after running `0005` + the promote SQL. Our automated gate is `lint` + `build` + code-review only.
