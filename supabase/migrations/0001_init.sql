-- 0001_init.sql — Campus Conveyance core schema (idempotent)
create extension if not exists "pgcrypto";

do $$ begin
  create type user_role as enum
    ('SUPER_ADMIN','INSTITUTION_ADMIN','STUDENT','PARENT','DRIVER');
exception when duplicate_object then null; end $$;
do $$ begin
  create type booking_status as enum
    ('PENDING','CONFIRMED','CANCELLED','WAITLISTED');
exception when duplicate_object then null; end $$;
do $$ begin
  create type payment_status as enum ('CREATED','PAID','FAILED','REFUNDED');
exception when duplicate_object then null; end $$;
do $$ begin
  create type attendance_event as enum ('BOARD','DROP');
exception when duplicate_object then null; end $$;

-- updated_at trigger
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;

create table if not exists institutions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  contact_email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  institution_id uuid references institutions(id) on delete set null,
  role user_role not null default 'STUDENT',
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_profiles_institution on profiles(institution_id);

create table if not exists institution_admins (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, profile_id)
);

create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  profile_id uuid references profiles(id) on delete set null,
  roll_no text,
  grade text,
  qr_code text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_students_institution on students(institution_id);

create table if not exists parents (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  profile_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists parent_students (
  parent_id uuid not null references parents(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  primary key (parent_id, student_id)
);

create table if not exists drivers (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  profile_id uuid references profiles(id) on delete set null,
  license_no text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_drivers_institution on drivers(institution_id);

create table if not exists vehicles (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  registration_no text not null,
  capacity int not null check (capacity > 0),
  model text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_vehicles_institution on vehicles(institution_id);

create table if not exists routes (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_routes_institution on routes(institution_id);

create table if not exists route_stops (
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
create index if not exists idx_route_stops_route on route_stops(route_id);

create table if not exists route_assignments (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  route_id uuid not null references routes(id) on delete cascade,
  vehicle_id uuid references vehicles(id) on delete set null,
  driver_id uuid references drivers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists seat_allocations (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  route_assignment_id uuid not null references route_assignments(id) on delete cascade,
  total_seats int not null check (total_seats >= 0),
  reserved_seats int not null default 0 check (reserved_seats >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bookings (
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
create index if not exists idx_bookings_institution on bookings(institution_id);

create table if not exists payments (
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
create index if not exists idx_payments_institution on payments(institution_id);

create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  route_id uuid references routes(id),
  event attendance_event not null,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_attendance_student on attendance(student_id);

create table if not exists gps_tracking (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  route_assignment_id uuid not null references route_assignments(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  recorded_at timestamptz not null default now()
);
create index if not exists idx_gps_assignment on gps_tracking(route_assignment_id, recorded_at desc);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  recipient_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  body text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_recipient on notifications(recipient_id, is_read);

create table if not exists complaints (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  raised_by uuid references profiles(id) on delete set null,
  subject text not null,
  body text,
  status text not null default 'OPEN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  plan text not null,
  status text not null default 'ACTIVE',
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists settings (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, key)
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references institutions(id) on delete set null,
  actor_id uuid references profiles(id) on delete set null,
  action text not null,
  entity text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_institution on audit_logs(institution_id, created_at desc);

-- updated_at triggers for tables that have the column
do $$
declare t text;
begin
  for t in select unnest(array['institutions','profiles','institution_admins',
    'students','parents','drivers','vehicles','routes','route_stops',
    'route_assignments','seat_allocations','bookings','payments','complaints',
    'subscriptions','settings'])
  loop
    execute format('drop trigger if exists trg_%I_updated on %I;', t, t);
    execute format(
      'create trigger trg_%I_updated before update on %I
       for each row execute function set_updated_at();', t, t);
  end loop;
end $$;

-- auto-create profile on new auth user.
-- search_path is pinned so the unqualified types/tables resolve when GoTrue
-- fires this SECURITY DEFINER trigger from its own session.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, new.raw_user_meta_data->>'full_name',
          coalesce((new.raw_user_meta_data->>'role')::public.user_role,'STUDENT'));
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
