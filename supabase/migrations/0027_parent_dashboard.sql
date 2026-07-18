-- 0027_parent_dashboard.sql (idempotent)
-- First real Parent slice: a parent links their child by the child's account
-- email and then sees the child's bookings. All access goes through
-- SECURITY DEFINER RPCs (parents/parent_students are RLS-locked with no
-- client policies, which is the secure default from 0002).

-- Parents are marketplace users like students — not tied to one institution.
alter table parents alter column institution_id drop not null;

-- Link a child by their student-account email. Creates the caller's parents
-- row and the child's students row on first use, so linking works even before
-- the student's first booking.
create or replace function public.link_child(p_email text)
returns table (student_id uuid, full_name text, email text)
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text; v_parent parents;
  v_profile profiles; v_student students;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode='P0001'; end if;
  select role::text into v_role from profiles where id = v_uid;
  if v_role not in ('PARENT','SUPER_ADMIN') then
    raise exception 'Only parent accounts can link a child' using errcode='P0003';
  end if;

  select * into v_profile from profiles
   where lower(profiles.email) = lower(trim(p_email))
     and role = 'STUDENT' and coalesce(is_deleted, false) = false
   limit 1;
  if v_profile.id is null then
    raise exception 'No student account found with that email'
      using errcode = 'P0002';
  end if;
  if v_profile.id = v_uid then
    raise exception 'You cannot link your own account' using errcode='P0005';
  end if;

  select * into v_parent from parents where profile_id = v_uid limit 1;
  if v_parent.id is null then
    insert into parents (profile_id) values (v_uid) returning * into v_parent;
  end if;

  select * into v_student from students where profile_id = v_profile.id limit 1;
  if v_student.id is null then
    insert into students (profile_id) values (v_profile.id) returning * into v_student;
  end if;

  insert into parent_students (parent_id, student_id)
  values (v_parent.id, v_student.id)
  on conflict do nothing;

  return query select v_student.id, v_profile.full_name, v_profile.email;
end; $$;
grant execute on function public.link_child(text) to authenticated;

-- Remove a linked child.
create or replace function public.unlink_child(p_student_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_parent parents;
begin
  select * into v_parent from parents where profile_id = auth.uid() limit 1;
  if v_parent.id is null then
    raise exception 'No parent record for this account' using errcode='P0001';
  end if;
  delete from parent_students
   where parent_id = v_parent.id and student_id = p_student_id;
end; $$;
grant execute on function public.unlink_child(uuid) to authenticated;

-- The caller's linked children with their profile details.
create or replace function public.parent_children()
returns table (student_id uuid, full_name text, email text, phone text,
               grade text, address text)
language sql stable security definer set search_path = public as $$
  select s.id, p.full_name, p.email, p.phone, s.grade, s.address
  from parent_students ps
  join parents pa on pa.id = ps.parent_id and pa.profile_id = auth.uid()
  join students s on s.id = ps.student_id
  left join profiles p on p.id = s.profile_id
  order by p.full_name nulls last;
$$;
grant execute on function public.parent_children() to authenticated;

-- Every booking of every linked child, with route/bus/driver context.
create or replace function public.parent_children_bookings()
returns table (booking_id uuid, student_id uuid, student_name text,
               route_name text, institution_name text, status text,
               is_paid boolean, created_at timestamptz, pickup_name text,
               departure_time time, bus_number text,
               driver_name text, driver_phone text)
language sql stable security definer set search_path = public as $$
  select b.id, s.id, coalesce(pr.full_name, b.student_name),
         coalesce(r.name, r.start_location), i.name, b.status::text,
         b.is_paid, b.created_at, st.name,
         r.departure_time, v.bus_number, v.driver_name, v.driver_phone
  from parent_students ps
  join parents pa on pa.id = ps.parent_id and pa.profile_id = auth.uid()
  join students s on s.id = ps.student_id
  join bookings b on b.student_id = s.id
  join routes r on r.id = b.route_id
  left join institutions i on i.id = r.institution_id
  left join vehicles v on v.id = r.vehicle_id
  left join route_stops st on st.id = b.pickup_stop_id
  left join profiles pr on pr.id = s.profile_id
  order by b.created_at desc;
$$;
grant execute on function public.parent_children_bookings() to authenticated;
