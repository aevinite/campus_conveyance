-- 0004_marketplace.sql — schools/colleges + agencies + bus/van catalog (idempotent)

do $$ begin create type vehicle_type as enum ('BUS','VAN');
exception when duplicate_object then null; end $$;
do $$ begin create type institution_kind as enum ('SCHOOL','COLLEGE');
exception when duplicate_object then null; end $$;
alter type user_role add value if not exists 'AGENCY';

-- Schools/colleges gain a kind, description and image.
alter table institutions add column if not exists kind institution_kind not null default 'SCHOOL';
alter table institutions add column if not exists description text;
alter table institutions add column if not exists image_url text;

-- Transport agencies (service providers).
create table if not exists agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  gst_number text,
  pan_number text,
  description text,
  logo_url text,
  owner_profile_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_agencies_updated on agencies;
create trigger trg_agencies_updated before update on agencies
  for each row execute function set_updated_at();

-- Vehicles and routes belong to an agency and are a bus or a van.
alter table vehicles add column if not exists agency_id uuid references agencies(id) on delete set null;
alter table vehicles add column if not exists vehicle_type vehicle_type not null default 'BUS';
alter table routes add column if not exists agency_id uuid references agencies(id) on delete set null;
alter table routes add column if not exists vehicle_type vehicle_type not null default 'BUS';

-- Marketplace: a student is not bound to a single school.
alter table students alter column institution_id drop not null;

-- RLS — agencies: anyone signed in can browse; admin or the owning agency writes.
alter table agencies enable row level security;
drop policy if exists agencies_read on agencies;
create policy agencies_read on agencies for select to authenticated using (true);
drop policy if exists agencies_write on agencies;
create policy agencies_write on agencies for all
  using (public.jwt_role() = 'SUPER_ADMIN' or owner_profile_id = auth.uid())
  with check (public.jwt_role() = 'SUPER_ADMIN' or owner_profile_id = auth.uid());

-- Catalog tables: readable by any signed-in user (the marketplace browse).
do $$
declare t text;
begin
  for t in select unnest(array['institutions','routes','route_stops','vehicles',
    'seat_allocations','route_assignments'])
  loop
    execute format('drop policy if exists %1$s_public_read on public.%1$I;', t);
    execute format(
      'create policy %1$s_public_read on public.%1$I for select to authenticated using (true);', t);
  end loop;
end $$;

-- A student can read their own bookings regardless of which school they booked.
drop policy if exists bookings_owner_read on bookings;
create policy bookings_owner_read on bookings for select to authenticated
  using (student_id in (select id from students where profile_id = auth.uid()));

-- reserve_seat v2: any signed-in user can book at any school; auto-create their
-- student record; the booking belongs to the route's institution.
create or replace function public.reserve_seat(
  p_route_id uuid, p_pickup_stop_id uuid, p_drop_stop_id uuid
) returns bookings language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid;
  v_route routes;
  v_student students;
  v_alloc seat_allocations;
  v_got uuid;
  v_booking bookings;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated' using errcode = 'P0001'; end if;

  select * into v_route from routes where id = p_route_id;
  if v_route.id is null then raise exception 'Route not found' using errcode = 'P0002'; end if;

  select * into v_student from students where profile_id = v_uid limit 1;
  if v_student.id is null then
    insert into students (profile_id) values (v_uid) returning * into v_student;
  end if;

  select sa.* into v_alloc
    from seat_allocations sa
    join route_assignments ra on ra.id = sa.route_assignment_id
   where ra.route_id = p_route_id
   order by sa.created_at
   limit 1;
  if v_alloc.id is null then
    raise exception 'No seats configured for this route' using errcode = 'P0004';
  end if;

  update seat_allocations
     set reserved_seats = reserved_seats + 1
   where id = v_alloc.id and reserved_seats < total_seats
  returning id into v_got;

  if v_got is not null then
    insert into bookings (institution_id, student_id, route_id, pickup_stop_id,
      drop_stop_id, status, seat_allocation_id)
    values (v_route.institution_id, v_student.id, p_route_id, p_pickup_stop_id,
      p_drop_stop_id, 'CONFIRMED', v_alloc.id)
    returning * into v_booking;
  else
    insert into bookings (institution_id, student_id, route_id, pickup_stop_id,
      drop_stop_id, status)
    values (v_route.institution_id, v_student.id, p_route_id, p_pickup_stop_id,
      p_drop_stop_id, 'WAITLISTED')
    returning * into v_booking;
  end if;

  return v_booking;
end; $$;
