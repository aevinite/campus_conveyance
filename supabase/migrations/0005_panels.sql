-- 0005_panels.sql — admin + agency panels (idempotent)
-- Adds: agency status + heavy-KYC + soft-delete, agency_services, bus/route
-- columns, college fields, profile soft-delete, per-agency hidden students,
-- agency/admin RLS, and the agency-approval booking flow (PENDING hold).

----------------------------------------------------------------------
-- 1. Enums + table extensions
----------------------------------------------------------------------
do $$ begin create type agency_status as enum ('PENDING','APPROVED','REJECTED');
exception when duplicate_object then null; end $$;

-- agencies: status, soft-delete, heavy KYC
alter table agencies add column if not exists status agency_status not null default 'PENDING';
alter table agencies add column if not exists is_deleted boolean not null default false;
alter table agencies add column if not exists deleted_at timestamptz;
alter table agencies add column if not exists legal_name text;
alter table agencies add column if not exists registration_no text;       -- CIN / Udyam
alter table agencies add column if not exists registered_address text;
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

-- vehicles (Add Bus, Fig 37) — registration + institution optional for agency buses
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
alter table route_assignments alter column institution_id drop not null;
alter table seat_allocations alter column institution_id drop not null;

-- institutions (Add College, Fig 26)
alter table institutions add column if not exists area text;
alter table institutions add column if not exists city text;

-- profiles soft-delete (admin Manage Students) + email (shown in admin/agency tables)
alter table profiles add column if not exists is_deleted boolean not null default false;
alter table profiles add column if not exists deleted_at timestamptz;
alter table profiles add column if not exists email text;
update profiles p set email = u.email
  from auth.users u where u.id = p.id and p.email is null;

-- handle_new_user override: copy email into the profile, and for an AGENCY
-- signup create the (PENDING) agency row from the signup metadata. Doing this
-- in the trigger avoids the "no session yet" problem when email confirmation is
-- on (the action can't insert as auth.uid() until the user confirms + logs in).
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_role public.user_role;
begin
  v_role := coalesce((new.raw_user_meta_data->>'role')::public.user_role,'STUDENT');
  insert into public.profiles (id, full_name, email, role)
  values (new.id, new.raw_user_meta_data->>'full_name', new.email, v_role);

  if v_role = 'AGENCY' then
    insert into public.agencies (owner_profile_id, name, email, phone, legal_name,
      registration_no, gst_number, pan_number, registered_address,
      permit_doc_url, fitness_doc_url, status)
    values (new.id,
      coalesce(new.raw_user_meta_data->>'full_name','Agency'),
      new.email,
      new.raw_user_meta_data->>'phone',
      new.raw_user_meta_data->>'legal_name',
      new.raw_user_meta_data->>'registration_no',
      new.raw_user_meta_data->>'gst_number',
      new.raw_user_meta_data->>'pan_number',
      new.raw_user_meta_data->>'registered_address',
      nullif(new.raw_user_meta_data->>'permit_doc_url',''),
      nullif(new.raw_user_meta_data->>'fitness_doc_url',''),
      'PENDING');
  end if;
  return new;
end; $$;

-- per-agency hidden students (agency Deleted Students)
create table if not exists agency_hidden_students (
  agency_id uuid not null references agencies(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (agency_id, student_id)
);

----------------------------------------------------------------------
-- 2. RLS
----------------------------------------------------------------------
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

-- vehicles / routes: agency-owner write (OR'd with the existing tenant_rw policy).
drop policy if exists vehicles_agency_write on vehicles;
create policy vehicles_agency_write on vehicles for all to authenticated
  using (agency_id in (select id from agencies where owner_profile_id=auth.uid() and status='APPROVED'))
  with check (agency_id in (select id from agencies where owner_profile_id=auth.uid() and status='APPROVED'));
drop policy if exists routes_agency_write on routes;
create policy routes_agency_write on routes for all to authenticated
  using (agency_id in (select id from agencies where owner_profile_id=auth.uid() and status='APPROVED'))
  with check (agency_id in (select id from agencies where owner_profile_id=auth.uid() and status='APPROVED'));

-- bookings: agency can read bookings on its own routes.
drop policy if exists bookings_agency_read on bookings;
create policy bookings_agency_read on bookings for select to authenticated
  using (route_id in (select id from routes where agency_id in
    (select id from agencies where owner_profile_id=auth.uid())));

-- profiles: admin can update any row (soft delete/restore students).
drop policy if exists profiles_admin_write on profiles;
create policy profiles_admin_write on profiles for update to authenticated
  using (public.jwt_role()='SUPER_ADMIN') with check (public.jwt_role()='SUPER_ADMIN');

-- agency_hidden_students: owning agency only.
alter table agency_hidden_students enable row level security;
drop policy if exists ahs_owner on agency_hidden_students;
create policy ahs_owner on agency_hidden_students for all to authenticated
  using (agency_id in (select id from agencies where owner_profile_id=auth.uid()))
  with check (agency_id in (select id from agencies where owner_profile_id=auth.uid()));

----------------------------------------------------------------------
-- 3. Booking flow → agency approval (PENDING hold)
----------------------------------------------------------------------
-- reserve_seat v3: hold as PENDING (was CONFIRMED). Seat still incremented so
-- capacity is honoured while the agency decides. Marketplace booking: any
-- signed-in user, auto-create their student row, booking belongs to the route's
-- institution.
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

-- cancel_booking: also free the seat for a held PENDING booking (not only CONFIRMED).
create or replace function public.cancel_booking(p_booking_id uuid)
returns bookings language plpgsql security definer set search_path = public as $$
declare v_student students; v_booking bookings;
begin
  select * into v_student from students where profile_id = auth.uid() limit 1;
  if v_student.id is null then
    raise exception 'No student record for this account' using errcode='P0001'; end if;
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if v_booking.student_id <> v_student.id then
    raise exception 'Not your booking' using errcode='P0003'; end if;
  if v_booking.status = 'CANCELLED' then return v_booking; end if;
  if v_booking.status in ('CONFIRMED','PENDING') and v_booking.seat_allocation_id is not null then
    update seat_allocations set reserved_seats = greatest(reserved_seats - 1, 0)
     where id = v_booking.seat_allocation_id;
  end if;
  update bookings set status='CANCELLED' where id = p_booking_id returning * into v_booking;
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
    coalesce(nullif(p_start_location,''),'Route'), p_start_location, p_price_cents, p_departure_time, p_image_url, true)
  returning * into v_route;
  insert into route_assignments (institution_id, route_id, vehicle_id)
  values (p_institution_id, v_route.id, p_vehicle_id) returning id into v_ra;
  insert into seat_allocations (institution_id, route_assignment_id, total_seats, reserved_seats)
  values (p_institution_id, v_ra, v_cap, 0);
  return v_route;
end; $$;

-- Agency-scoped read RPCs (SECURITY DEFINER: join to profiles, which agency RLS
-- would otherwise block). Each verifies the caller owns the agency.
create or replace function public.agency_bookings(p_agency_id uuid)
returns table (
  booking_id uuid, status text, student_name text, student_email text,
  student_phone text, start_location text, end_name text, created_at timestamptz
) language sql stable security definer set search_path = public as $$
  select b.id, b.status::text, pr.full_name, pr.email, pr.phone,
         coalesce(r.start_location, r.name), i.name, b.created_at
  from bookings b
  join routes r on r.id = b.route_id
  left join institutions i on i.id = r.institution_id
  left join students s on s.id = b.student_id
  left join profiles pr on pr.id = s.profile_id
  where r.agency_id = p_agency_id
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid())
  order by b.created_at desc;
$$;

create or replace function public.agency_students(p_agency_id uuid)
returns table (
  student_id uuid, name text, email text, phone text, hidden boolean
) language sql stable security definer set search_path = public as $$
  select distinct s.id, pr.full_name, pr.email, pr.phone,
         (h.student_id is not null) as hidden
  from bookings b
  join routes r on r.id = b.route_id
  join students s on s.id = b.student_id
  left join profiles pr on pr.id = s.profile_id
  left join agency_hidden_students h on h.student_id = s.id and h.agency_id = p_agency_id
  where r.agency_id = p_agency_id
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid());
$$;

grant execute on function public.reserve_seat(uuid, uuid, uuid) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;
grant execute on function public.agency_owns_booking(uuid) to authenticated;
grant execute on function public.confirm_booking(uuid) to authenticated;
grant execute on function public.reject_booking(uuid) to authenticated;
grant execute on function public.add_route(uuid, uuid, uuid, uuid, text, bigint, time, text) to authenticated;
grant execute on function public.agency_bookings(uuid) to authenticated;
grant execute on function public.agency_students(uuid) to authenticated;
