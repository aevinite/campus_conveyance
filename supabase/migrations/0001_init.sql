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
