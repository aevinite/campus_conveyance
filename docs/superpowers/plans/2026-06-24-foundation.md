# Campus Conveyance Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the runnable foundation of the Campus Conveyance multi-tenant SaaS — Next.js 15 scaffold, complete Supabase schema with RLS-based tenant isolation, and full auth + RBAC with role-routed dashboard shells.

**Architecture:** Next.js 15 App Router with `@supabase/ssr` cookie auth. Tenant isolation is enforced in Postgres via RLS policies that read `institution_id` + `role` from JWT claims injected by a custom access-token hook. App code uses a repository → service → action layering with Zod validation and centralized errors.

**Tech Stack:** Next.js 15, TypeScript, Tailwind, shadcn/ui, Framer Motion, Supabase (Postgres/Auth), Zod, React Hook Form, React Query.

---

## File Structure

```
.env.example                          env template
supabase/migrations/0001_init.sql     full schema + enum + triggers
supabase/migrations/0002_rls.sql      RLS policies + access-token hook fn
src/lib/supabase/server.ts            server component client
src/lib/supabase/client.ts            browser client
src/lib/supabase/middleware.ts        session-refresh helper
src/lib/rbac/roles.ts                 Role type + route map + guards
src/lib/errors/app-error.ts           typed error hierarchy + handler
src/lib/repository/base.ts            base repository
src/features/auth/schemas.ts          Zod schemas for auth forms
src/features/auth/actions.ts          server actions: register/login/etc.
src/features/auth/services.ts         auth business logic
src/middleware.ts                     route protection
src/app/(auth)/...                    login/register/verify/forgot/reset
src/app/(dashboard)/...               role-aware shells
src/components/ui/...                  shadcn components
```

---

## Task 1: Scaffold Next.js 15 + Tailwind + TypeScript

**Files:** Create project in repo root.

- [ ] **Step 1: Scaffold**

Run (in the repo root; the dir already has `docs/` and `.git`):
```bash
npx create-next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-turbopack
```
If prompted about a non-empty directory, choose to continue (it keeps `docs/`, `.git`).

- [ ] **Step 2: Verify it runs**

Run: `npm run build`
Expected: build completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js 15 app"
```

---

## Task 2: Install dependencies + init shadcn/ui

**Files:** `package.json`, `components.json`.

- [ ] **Step 1: Install runtime deps**

```bash
npm install @supabase/supabase-js @supabase/ssr zod react-hook-form @hookform/resolvers @tanstack/react-query framer-motion lucide-react
```

- [ ] **Step 2: Init shadcn and add base components**

```bash
npx shadcn@latest init -d
npx shadcn@latest add button input label card form sonner dropdown-menu avatar separator
```
Expected: components appear under `src/components/ui/`.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: add deps and shadcn/ui base components"
```

---

## Task 3: Environment template + Supabase setup doc

**Files:** Create `.env.example`, `docs/SUPABASE_SETUP.md`.

- [ ] **Step 1: Write `.env.example`**

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

- [ ] **Step 2: Write `docs/SUPABASE_SETUP.md`** with these exact user steps:

1. Go to supabase.com → New project. Copy **Project URL** and **anon key**
   (Settings → API), and the **service_role key**.
2. Copy `.env.example` to `.env.local` and paste the three values.
3. In the Supabase SQL editor, run `supabase/migrations/0001_init.sql` then
   `0002_rls.sql` (paste contents, Run).
4. Auth → Hooks → **Customize Access Token (JWT) Claims** → enable, select
   schema `public`, function `custom_access_token_hook`.
5. Auth → URL Configuration → set Site URL to `http://localhost:3000`.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "docs: env template and Supabase setup guide"
```

---

## Task 4: Database schema migration

**Files:** Create `supabase/migrations/0001_init.sql`.

- [ ] **Step 1: Write the migration**

```sql
-- 0001_init.sql — Campus Conveyance core schema
create extension if not exists "pgcrypto";

create type user_role as enum
  ('SUPER_ADMIN','INSTITUTION_ADMIN','STUDENT','PARENT','DRIVER');
create type booking_status as enum
  ('PENDING','CONFIRMED','CANCELLED','WAITLISTED');
create type payment_status as enum ('CREATED','PAID','FAILED','REFUNDED');
create type attendance_event as enum ('BOARD','DROP');

-- updated_at trigger
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;

create table institutions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  contact_email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  institution_id uuid references institutions(id) on delete set null,
  role user_role not null default 'STUDENT',
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_profiles_institution on profiles(institution_id);

create table institution_admins (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, profile_id)
);

create table students (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  profile_id uuid references profiles(id) on delete set null,
  roll_no text,
  grade text,
  qr_code text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_students_institution on students(institution_id);

create table parents (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  profile_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table parent_students (
  parent_id uuid not null references parents(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  primary key (parent_id, student_id)
);

create table drivers (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  profile_id uuid references profiles(id) on delete set null,
  license_no text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_drivers_institution on drivers(institution_id);

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  registration_no text not null,
  capacity int not null check (capacity > 0),
  model text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_vehicles_institution on vehicles(institution_id);

create table routes (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_routes_institution on routes(institution_id);

create table route_stops (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  route_id uuid not null references routes(id) on delete cascade,
  name text not null,
  lat double precision,
  lng double precision,
  sequence int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_route_stops_route on route_stops(route_id);

create table route_assignments (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  route_id uuid not null references routes(id) on delete cascade,
  vehicle_id uuid references vehicles(id) on delete set null,
  driver_id uuid references drivers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table seat_allocations (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  route_assignment_id uuid not null references route_assignments(id) on delete cascade,
  total_seats int not null check (total_seats >= 0),
  reserved_seats int not null default 0 check (reserved_seats >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  route_id uuid not null references routes(id) on delete cascade,
  pickup_stop_id uuid references route_stops(id),
  drop_stop_id uuid references route_stops(id),
  status booking_status not null default 'PENDING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_bookings_institution on bookings(institution_id);

create table payments (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  booking_id uuid references bookings(id) on delete set null,
  amount_cents bigint not null check (amount_cents >= 0),
  currency text not null default 'INR',
  status payment_status not null default 'CREATED',
  razorpay_order_id text,
  razorpay_payment_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_payments_institution on payments(institution_id);

create table attendance (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  route_id uuid references routes(id),
  event attendance_event not null,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index idx_attendance_student on attendance(student_id);

create table gps_tracking (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  route_assignment_id uuid not null references route_assignments(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  recorded_at timestamptz not null default now()
);
create index idx_gps_assignment on gps_tracking(route_assignment_id, recorded_at desc);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  recipient_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  body text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_notifications_recipient on notifications(recipient_id, is_read);

create table complaints (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  raised_by uuid references profiles(id) on delete set null,
  subject text not null,
  body text,
  status text not null default 'OPEN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  plan text not null,
  status text not null default 'ACTIVE',
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table settings (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, key)
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references institutions(id) on delete set null,
  actor_id uuid references profiles(id) on delete set null,
  action text not null,
  entity text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_audit_institution on audit_logs(institution_id, created_at desc);

-- updated_at triggers for tables that have the column
do $$
declare t text;
begin
  for t in select unnest(array['institutions','profiles','institution_admins',
    'students','parents','drivers','vehicles','routes','route_stops',
    'route_assignments','seat_allocations','bookings','payments','complaints',
    'subscriptions','settings'])
  loop
    execute format(
      'create trigger trg_%I_updated before update on %I
       for each row execute function set_updated_at();', t, t);
  end loop;
end $$;

-- auto-create profile on new auth user
create or replace function handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, new.raw_user_meta_data->>'full_name',
          coalesce((new.raw_user_meta_data->>'role')::user_role,'STUDENT'));
  return new;
end; $$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(db): core schema migration"
```

---

## Task 5: RLS policies + access-token hook

**Files:** Create `supabase/migrations/0002_rls.sql`.

- [ ] **Step 1: Write the migration**

```sql
-- 0002_rls.sql — access-token hook + tenant-isolation RLS

-- Inject institution_id + role into JWT claims at issue/refresh time.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable as $$
declare claims jsonb; p record;
begin
  select institution_id, role into p
  from public.profiles where id = (event->>'user_id')::uuid;
  claims := coalesce(event->'claims','{}'::jsonb);
  if p.institution_id is not null then
    claims := jsonb_set(claims,'{app_metadata,institution_id}',
                        to_jsonb(p.institution_id::text));
  end if;
  if p.role is not null then
    claims := jsonb_set(claims,'{app_metadata,role}', to_jsonb(p.role::text));
  end if;
  return jsonb_set(event,'{claims}',claims);
end; $$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
grant select on public.profiles to supabase_auth_admin;

-- Claim helpers
create or replace function auth.jwt_institution() returns uuid
language sql stable as $$
  select nullif(auth.jwt()->'app_metadata'->>'institution_id','')::uuid; $$;

create or replace function auth.jwt_role() returns text
language sql stable as $$
  select auth.jwt()->'app_metadata'->>'role'; $$;

-- Enable RLS on every table
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname='public'
           and tablename <> 'parent_students'
  loop execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- profiles: a user sees their own row; super admin sees all; same-tenant read
create policy profiles_self on profiles for select
  using (id = auth.uid() or auth.jwt_role()='SUPER_ADMIN'
         or institution_id = auth.jwt_institution());
create policy profiles_update_self on profiles for update
  using (id = auth.uid());

-- institutions: super admin all; others only their own
create policy inst_select on institutions for select
  using (auth.jwt_role()='SUPER_ADMIN' or id = auth.jwt_institution());
create policy inst_super_write on institutions for all
  using (auth.jwt_role()='SUPER_ADMIN')
  with check (auth.jwt_role()='SUPER_ADMIN');

-- Generic tenant isolation for all tables carrying institution_id.
-- Read: same tenant or super admin. Write: same tenant (admin/driver scope
-- refined in later slices) or super admin.
do $$
declare t text;
begin
  for t in select unnest(array['institution_admins','students','parents',
    'drivers','vehicles','routes','route_stops','route_assignments',
    'seat_allocations','bookings','payments','attendance','gps_tracking',
    'notifications','complaints','subscriptions','settings','audit_logs'])
  loop
    execute format($f$
      create policy %1$s_tenant_rw on public.%1$I for all
      using (auth.jwt_role()='SUPER_ADMIN'
             or institution_id = auth.jwt_institution())
      with check (auth.jwt_role()='SUPER_ADMIN'
             or institution_id = auth.jwt_institution());
    $f$, t);
  end loop;
end $$;
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(db): RLS tenant isolation + access-token hook"
```

---

## Task 6: Supabase clients

**Files:** Create `src/lib/supabase/server.ts`, `client.ts`, `middleware.ts`.

- [ ] **Step 1: `client.ts` (browser)**

```ts
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

- [ ] **Step 2: `server.ts` (server components / actions)**

```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options));
          } catch { /* called from a Server Component; middleware refreshes */ }
        },
      },
    },
  );
}
```

- [ ] **Step 3: `middleware.ts` helper**

```ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options));
        },
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  return { response, user };
}
```

- [ ] **Step 4: Verify + commit**

Run: `npm run build` → Expected: PASS.
```bash
git add -A && git commit -m "feat(supabase): server/browser/middleware clients"
```

---

## Task 7: RBAC + errors + base repository

**Files:** Create `src/lib/rbac/roles.ts`, `src/lib/errors/app-error.ts`, `src/lib/repository/base.ts`.

- [ ] **Step 1: `roles.ts`**

```ts
export const ROLES = ['SUPER_ADMIN','INSTITUTION_ADMIN','STUDENT','PARENT','DRIVER'] as const;
export type Role = (typeof ROLES)[number];

export const DASHBOARD_BY_ROLE: Record<Role, string> = {
  SUPER_ADMIN: '/super-admin',
  INSTITUTION_ADMIN: '/institution',
  STUDENT: '/student',
  PARENT: '/parent',
  DRIVER: '/driver',
};

export function dashboardFor(role: Role | undefined): string {
  return role ? DASHBOARD_BY_ROLE[role] : '/login';
}

export function roleFromClaims(appMetadata: unknown): Role | undefined {
  const r = (appMetadata as { role?: string } | null)?.role;
  return ROLES.includes(r as Role) ? (r as Role) : undefined;
}
```

- [ ] **Step 2: `app-error.ts`**

```ts
export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = 'AppError';
  }
}
export class AuthError extends AppError {
  constructor(message = 'Unauthorized') { super('AUTH', message, 401); }
}
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') { super('FORBIDDEN', message, 403); }
}

export function toErrorResponse(err: unknown): { code: string; message: string; status: number } {
  if (err instanceof AppError) return { code: err.code, message: err.message, status: err.status };
  return { code: 'INTERNAL', message: 'Something went wrong', status: 500 };
}
```

- [ ] **Step 3: `base.ts` repository**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export abstract class BaseRepository {
  constructor(protected readonly db: SupabaseClient) {}
}
```

- [ ] **Step 4: Verify + commit**

Run: `npm run build` → Expected: PASS.
```bash
git add -A && git commit -m "feat(lib): rbac, errors, base repository"
```

---

## Task 8: Root middleware (route protection)

**Files:** Create `src/middleware.ts`.

- [ ] **Step 1: Write it**

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { dashboardFor, roleFromClaims } from '@/lib/rbac/roles';

const PUBLIC = ['/', '/login', '/register', '/verify', '/forgot', '/reset', '/auth'];

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC.some((p) => path === p || path.startsWith(p + '/'));

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (user && (path === '/login' || path === '/register')) {
    const role = roleFromClaims((user.app_metadata as Record<string, unknown>));
    return NextResponse.redirect(new URL(dashboardFor(role), request.url));
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
```

- [ ] **Step 2: Verify + commit**

Run: `npm run build` → Expected: PASS.
```bash
git add -A && git commit -m "feat(auth): route-protection middleware"
```

---

## Task 9: Auth schemas + actions + services

**Files:** Create `src/features/auth/schemas.ts`, `services.ts`, `actions.ts`.

- [ ] **Step 1: `schemas.ts`**

```ts
import { z } from 'zod';
import { ROLES } from '@/lib/rbac/roles';

export const registerSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(ROLES),
});
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export const forgotSchema = z.object({ email: z.string().email() });
export const resetSchema = z.object({ password: z.string().min(8) });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
```

- [ ] **Step 2: `services.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RegisterInput, LoginInput } from './schemas';
import { AuthError } from '@/lib/errors/app-error';

export async function registerUser(db: SupabaseClient, input: RegisterInput, redirectTo: string) {
  const { error } = await db.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: redirectTo,
      data: { full_name: input.fullName, role: input.role },
    },
  });
  if (error) throw new AuthError(error.message);
}

export async function loginUser(db: SupabaseClient, input: LoginInput) {
  const { error } = await db.auth.signInWithPassword(input);
  if (error) throw new AuthError(error.message);
}
```

- [ ] **Step 3: `actions.ts` (server actions)**

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { registerSchema, loginSchema, forgotSchema } from './schemas';
import { registerUser, loginUser } from './services';
import { dashboardFor, roleFromClaims } from '@/lib/rbac/roles';
import { toErrorResponse } from '@/lib/errors/app-error';

type State = { error?: string };

export async function registerAction(_: State, formData: FormData): Promise<State> {
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Please check the form fields.' };
  const db = await createClient();
  const site = process.env.NEXT_PUBLIC_SITE_URL!;
  try {
    await registerUser(db, parsed.data, `${site}/auth/callback`);
  } catch (e) { return { error: toErrorResponse(e).message }; }
  redirect('/verify');
}

export async function loginAction(_: State, formData: FormData): Promise<State> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Please check the form fields.' };
  const db = await createClient();
  try { await loginUser(db, parsed.data); }
  catch (e) { return { error: toErrorResponse(e).message }; }
  const { data: { user } } = await db.auth.getUser();
  const role = roleFromClaims(user?.app_metadata as Record<string, unknown>);
  revalidatePath('/', 'layout');
  redirect(dashboardFor(role));
}

export async function logoutAction() {
  const db = await createClient();
  await db.auth.signOut();
  redirect('/login');
}

export async function forgotAction(_: State, formData: FormData): Promise<State> {
  const parsed = forgotSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Enter a valid email.' };
  const db = await createClient();
  const site = process.env.NEXT_PUBLIC_SITE_URL!;
  await db.auth.resetPasswordForEmail(parsed.data.email, { redirectTo: `${site}/reset` });
  return {};
}
```

- [ ] **Step 4: Verify + commit**

Run: `npm run build` → Expected: PASS.
```bash
git add -A && git commit -m "feat(auth): schemas, services, server actions"
```

---

## Task 10: Auth callback route + auth UI pages

**Files:** Create `src/app/auth/callback/route.ts`, and pages under `src/app/(auth)/`: `login/page.tsx`, `register/page.tsx`, `verify/page.tsx`, `forgot/page.tsx`, `reset/page.tsx`, plus a shared `src/features/auth/components/auth-form.tsx`.

- [ ] **Step 1: `auth/callback/route.ts`** (email verification / OAuth exchange)

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  if (code) {
    const db = await createClient();
    await db.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(`${origin}/login`);
}
```

- [ ] **Step 2: Build the auth pages.**

Each page is a client component using `react-hook-form` + the matching Zod
schema and `useActionState` to call the server action from Task 9. The login
page renders email + password; register renders full name, email, password, and
a role `<select>` bound to `ROLES`; forgot renders email; reset renders a new
password; verify is a static "check your email" card. Use shadcn `Card`,
`Input`, `Label`, `Button`, and `sonner` for toasts. Display the action's
`error` string inline.

Example — `login/page.tsx`:
```tsx
'use client';
import { useActionState } from 'react';
import Link from 'next/link';
import { loginAction } from '@/features/auth/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, {});
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader><CardTitle>Sign in to Campus Conveyance</CardTitle></CardHeader>
        <CardContent>
          <form action={action} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" required />
            </div>
            {state.error && <p className="text-sm text-red-500">{state.error}</p>}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? 'Signing in…' : 'Sign in'}
            </Button>
            <div className="flex justify-between text-sm">
              <Link href="/register" className="underline">Create account</Link>
              <Link href="/forgot" className="underline">Forgot password?</Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```
Build `register`, `forgot`, `reset`, `verify` following the same pattern with
their respective fields and actions. `register` includes:
```tsx
<select name="role" className="w-full rounded-md border p-2" required>
  <option value="STUDENT">Student</option>
  <option value="PARENT">Parent</option>
  <option value="DRIVER">Driver</option>
  <option value="INSTITUTION_ADMIN">Institution Admin</option>
</select>
```
(`SUPER_ADMIN` is intentionally not self-registerable.)

- [ ] **Step 3: Verify + commit**

Run: `npm run build` → Expected: PASS.
```bash
git add -A && git commit -m "feat(auth): callback route and auth UI pages"
```

---

## Task 11: Role-aware dashboard shells

**Files:** Create `src/app/(dashboard)/layout.tsx` and pages `super-admin/page.tsx`, `institution/page.tsx`, `student/page.tsx`, `parent/page.tsx`, `driver/page.tsx`. Create `src/features/auth/components/user-menu.tsx`.

- [ ] **Step 1: `(dashboard)/layout.tsx`** — server component that loads the user, enforces role, renders nav + logout.

```tsx
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { logoutAction } from '@/features/auth/actions';
import { Button } from '@/components/ui/button';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect('/login');
  const role = (user.app_metadata as { role?: string })?.role ?? 'STUDENT';
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <span className="font-semibold">Campus Conveyance</span>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{role}</span>
          <form action={logoutAction}>
            <Button variant="outline" size="sm">Log out</Button>
          </form>
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Each dashboard page** is a server component that double-checks
the role claim and renders a titled shell. Example `student/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function StudentDashboard() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  const role = (user?.app_metadata as { role?: string })?.role;
  if (role !== 'STUDENT' && role !== 'SUPER_ADMIN') redirect('/login');
  return (
    <section>
      <h1 className="text-2xl font-semibold">Student Dashboard</h1>
      <p className="text-muted-foreground">Bookings, attendance and live tracking arrive in the next slices.</p>
    </section>
  );
}
```
Build the other four with their titles and matching role checks
(`INSTITUTION_ADMIN`→institution, `PARENT`→parent, `DRIVER`→driver,
`SUPER_ADMIN`→super-admin; super-admin accepts only `SUPER_ADMIN`).

- [ ] **Step 3: Verify + commit**

Run: `npm run build` → Expected: PASS.
```bash
git add -A && git commit -m "feat(dashboard): role-aware shells and layout"
```

---

## Task 12: Landing page + providers + manual verification

**Files:** Modify `src/app/page.tsx`, `src/app/layout.tsx`; create `src/app/providers.tsx`.

- [ ] **Step 1: `providers.tsx`** — React Query + sonner Toaster.

```tsx
'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}
```
Wrap `{children}` in `app/layout.tsx` with `<Providers>`.

- [ ] **Step 2: `page.tsx`** — a simple landing with product name, tagline, and
"Sign in" / "Get started" links to `/login` and `/register` (Framer Motion fade-in).

- [ ] **Step 3: Verify build**

Run: `npm run build` → Expected: PASS, no TS errors.

- [ ] **Step 4: Manual end-to-end (requires the user's Supabase project + `.env.local`)**

Run: `npm run dev`. Then:
1. Register a STUDENT → redirected to `/verify`.
2. Confirm email (Supabase sends link) → `/auth/callback` → `/login`.
3. Log in → redirected to `/student`.
4. Log out → `/login`.
5. Visit `/institution` while logged in as STUDENT → redirected away.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(app): landing page, providers, slice 1 complete"
```

---

## Self-Review notes

- **Spec coverage:** scaffold (T1–2), env/setup (T3), full schema (T4),
  RLS+tenant isolation+hook (T5), Supabase clients (T6), repository/errors/RBAC
  (T7), middleware route protection (T8), auth flows incl. verify/forgot/reset
  (T9–10), role dashboards (T11), runnable app + manual verify (T12). All Slice 1
  goals mapped.
- **Type consistency:** `roleFromClaims`/`dashboardFor`/`Role`/`ROLES` defined
  in T7 and used consistently in T8–T11. `createClient` (server) signature
  matches across actions, callback, layout, pages.
- **Deferred by design:** booking/payments/GPS/attendance logic and dashboard
  data are later slices; their tables exist (T4) with tenant RLS (T5) ready.
```
