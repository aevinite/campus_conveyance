# Campus Conveyance — Slice 1: Foundation Design

**Company:** Aevinite
**Date:** 2026-06-24
**Status:** Approved (design); implementation pending plan

---

## Context

Campus Conveyance is a multi-tenant transportation-management SaaS for schools
and colleges. The full product spans booking, payments, live GPS, QR
attendance, notifications, and five role dashboards. That scope is too large for
a single implementation pass, so it is decomposed into vertical slices that are
each fully wired (DB → API → UI → auth) and verified before the next begins.

**This document covers Slice 1 — the Foundation** that every later slice
depends on. Later slices (booking engine, payments, GPS, attendance,
notifications, dashboards data) get their own spec → plan → implementation
cycle.

### External-service status
The user has **no** external credentials yet. The foundation requires **only
Supabase** (Postgres + Auth). Razorpay (payments) and Google Maps (GPS/routes)
are deferred to their respective later slices. The scaffold, schema, and auth
code can be written before credentials exist; the user creates a free Supabase
project in parallel and pastes keys into `.env.local`.

---

## Goals (Slice 1)

1. Runnable Next.js 15 app with the mandated stack and a feature-based layout.
2. Complete enterprise database schema (all tables) as one migration, with
   multi-tenant isolation enforced at the database level via RLS.
3. Working authentication: register, login, logout, email verification,
   forgot/reset password.
4. RBAC across five roles, with route-protection middleware that routes each
   user to the correct dashboard shell.

### Non-goals (Slice 1)
- Feature logic for booking, payments, GPS, attendance, notifications.
- Populated dashboard analytics (dashboards are role-aware shells only).

---

## Stack

- **Frontend:** Next.js 15 App Router, React, TypeScript, Tailwind CSS,
  shadcn/ui, Framer Motion.
- **Backend:** Next.js Route Handlers + Server Actions.
- **Data/Auth/Realtime/Storage:** Supabase (Postgres, Auth, Realtime, Storage).
- **Auth integration:** `@supabase/ssr` (cookie-based; the current correct
  approach for Next 15 — replaces the deprecated auth-helpers).
- **Validation:** Zod. **Forms:** React Hook Form. **Server state:** React Query.

---

## Folder structure (feature-based)

```
src/
  app/
    (auth)/            login, register, verify, forgot, reset routes
    (dashboard)/       role-aware dashboard shells
    api/               route handlers
  features/
    auth/              components, services, schemas
    institutions/      components, services, schemas
  lib/
    supabase/          server client, browser client, middleware client
    rbac/              role definitions + guards
    repository/        base repository pattern
    errors/            centralized error types + handler
  components/ui/        shadcn components
supabase/
  migrations/          SQL migrations
```

Rationale: features are self-contained so later slices slot in without
entangling existing code; `lib/` holds cross-cutting infrastructure
(repository pattern, error handling, RBAC).

---

## Database schema

One migration creates the full table set. Every tenant-owned table carries
`institution_id uuid` referencing `institutions(id)`.

Tables: `institutions`, `profiles` (1:1 with `auth.users`, holds role +
institution_id), `institution_admins`, `students`, `parents`, `drivers`,
`vehicles`, `routes`, `route_stops`, `route_assignments`, `seat_allocations`,
`bookings`, `payments`, `attendance`, `gps_tracking`, `notifications`,
`complaints`, `subscriptions`, `settings`, `audit_logs`.

Each table gets: primary key (uuid), foreign-key constraints, `created_at` /
`updated_at` timestamps, an `updated_at` trigger, and indexes on
`institution_id` and common lookup columns.

Role enum: `SUPER_ADMIN`, `INSTITUTION_ADMIN`, `STUDENT`, `PARENT`, `DRIVER`.

In Slice 1, only `institutions` and `profiles` are *exercised* by app code; the
remaining tables exist as schema for later slices.

---

## Multi-tenant isolation + RBAC (critical)

**Strategy: JWT claims via a Supabase custom access-token hook.**

- A Postgres function (the access-token hook) injects `institution_id` and
  `role` into each user's JWT at issue/refresh time, read from `profiles`.
- RLS policies on every tenant table read these claims
  (`auth.jwt() -> 'app_metadata'`) to scope rows to the user's institution.
- `SUPER_ADMIN` bypasses the tenant filter (platform-wide access).

**Why this approach:**
- Fast — no per-row subquery against `profiles`.
- Avoids the classic RLS pitfall where a policy queries the same table it
  protects and causes infinite recursion.

**Trade-offs / costs:**
- Claims refresh only when the token refreshes (acceptable: role/institution
  rarely change mid-session; we can force a refresh on change).
- The hook must be enabled once in the Supabase dashboard — documented with
  exact steps in the setup guide.

Rejected alternative: per-request `profiles` lookup inside RLS — slower and
recursion-prone.

---

## Auth flows

Real Supabase Auth for: register, login, logout, email verification,
forgot-password, reset-password. On register, a trigger (or server action)
creates the matching `profiles` row with the chosen role and institution.

**Route protection:** `middleware.ts` refreshes the session and guards routes;
a role guard redirects authenticated users to their dashboard
(`/super-admin`, `/institution`, `/student`, `/parent`, `/driver`) and blocks
cross-role access. Dashboards are real role-aware shells (layout + nav),
populated by later slices.

---

## Error handling, repository & service layers

- `lib/errors`: typed `AppError` hierarchy + a single handler that maps errors
  to consistent API responses.
- `lib/repository`: a base repository wrapping Supabase queries so feature
  services depend on a typed interface, not raw client calls.
- Feature `services`: business logic, called by Server Actions / Route Handlers.

---

## Verification (definition of done for Slice 1)

- `npm install` succeeds.
- `npm run build` succeeds with no TypeScript errors.
- `npm run dev` serves the app locally.
- With a real Supabase project connected: register → email verify → login →
  redirect-by-role → logout round-trip works, and RLS blocks cross-tenant reads
  (verified with two institutions' test users).

---

## Setup the user performs in parallel

1. Create a free Supabase project; copy Project URL, anon key, service-role key.
2. Paste into `.env.local` (template provided).
3. Run the provided migration against the project.
4. Enable the custom access-token hook in Auth → Hooks (exact steps provided).
