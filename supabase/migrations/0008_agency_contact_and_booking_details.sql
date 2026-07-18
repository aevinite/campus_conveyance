-- 0008_agency_contact_and_booking_details.sql (idempotent)
--
-- Merged from two files that both carried the "0008" prefix
-- (0008_agency_contact_person.sql + 0008_booking_student_details.sql). Duplicate
-- numeric prefixes let a migration runner keyed on the number apply only one of
-- the two and silently skip the other — which is exactly how the bookings
-- student_name/student_email columns (used by reserve_seat) could go missing on a
-- fresh deploy and surface as "42703 column does not exist". Combined into a
-- single 0008. The two parts are independent; order within the file does not
-- matter.

-- ── Part A: agency contact person + handle_new_user ──────────────────────────
-- Basic personal detail on an agency application: the human contact person.
alter table agencies add column if not exists contact_person text;

-- Re-declare handle_new_user so the PENDING agency row also stores the
-- contact person name pulled from the signup metadata.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_role public.user_role;
begin
  v_role := coalesce((new.raw_user_meta_data->>'role')::public.user_role,'STUDENT');
  insert into public.profiles (id, full_name, email, role)
  values (new.id, new.raw_user_meta_data->>'full_name', new.email, v_role);

  if v_role = 'AGENCY' then
    insert into public.agencies (owner_profile_id, name, email, phone, contact_person,
      legal_name, registration_no, gst_number, pan_number, registered_address,
      permit_doc_url, fitness_doc_url, status)
    values (new.id,
      coalesce(new.raw_user_meta_data->>'full_name','Agency'),
      new.email,
      new.raw_user_meta_data->>'phone',
      new.raw_user_meta_data->>'contact_person',
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

-- ── Part B: booking student name/email snapshot + reserve_seat ───────────────
-- Store the student's NAME and EMAIL directly on each booking, so the bookings
-- table is readable in the database instead of showing only a student_id UUID.
-- The student_id FK is kept as-is; name/email are a snapshot captured at booking
-- time. Idempotent (safe to re-run).

alter table public.bookings add column if not exists student_name  text;
alter table public.bookings add column if not exists student_email text;

-- Backfill existing bookings from each student's profile.
update public.bookings b
set student_name  = p.full_name,
    student_email = p.email
from public.students s
join public.profiles p on p.id = s.profile_id
where b.student_id = s.id
  and (b.student_name is null or b.student_email is null);

-- reserve_seat: unchanged logic, but now also stamps the booking with the
-- student's name + email (read from their profile) at reservation time.
create or replace function public.reserve_seat(
  p_route_id uuid, p_pickup_stop_id uuid, p_drop_stop_id uuid
) returns bookings language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid; v_route routes; v_student students; v_alloc seat_allocations;
  v_got uuid; v_booking bookings; v_name text; v_email text;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated' using errcode='P0001'; end if;
  select * into v_route from routes where id = p_route_id;
  if v_route.id is null then raise exception 'Route not found' using errcode='P0002'; end if;
  select * into v_student from students where profile_id = v_uid limit 1;
  if v_student.id is null then
    insert into students (profile_id) values (v_uid) returning * into v_student;
  end if;
  -- the student's display details, snapshotted onto the booking
  select full_name, email into v_name, v_email from profiles where id = v_uid;
  select sa.* into v_alloc from seat_allocations sa
    join route_assignments ra on ra.id = sa.route_assignment_id
   where ra.route_id = p_route_id order by sa.created_at limit 1;
  if v_alloc.id is null then
    raise exception 'No seats configured for this route' using errcode='P0004';
  end if;
  update seat_allocations set reserved_seats = reserved_seats + 1
   where id = v_alloc.id and reserved_seats < total_seats returning id into v_got;
  if v_got is not null then
    insert into bookings (institution_id, student_id, route_id, pickup_stop_id, drop_stop_id, status, seat_allocation_id, student_name, student_email)
    values (v_route.institution_id, v_student.id, p_route_id, p_pickup_stop_id, p_drop_stop_id, 'PENDING', v_alloc.id, v_name, v_email)
    returning * into v_booking;
  else
    insert into bookings (institution_id, student_id, route_id, pickup_stop_id, drop_stop_id, status, student_name, student_email)
    values (v_route.institution_id, v_student.id, p_route_id, p_pickup_stop_id, p_drop_stop_id, 'WAITLISTED', v_name, v_email)
    returning * into v_booking;
  end if;
  return v_booking;
end; $$;
grant execute on function public.reserve_seat(uuid, uuid, uuid) to authenticated;
