-- 0018_student_details_and_payment.sql (idempotent)
-- Booking flow upgrade: collect student details before route selection, and
-- confirm a held (PENDING) seat via a simulated payment.

-- 1) Student detail columns (name/phone live on profiles).
alter table students add column if not exists address text;
alter table students add column if not exists guardian_name text;
alter table students add column if not exists guardian_phone text;

-- 2) Read the signed-in student's details (security definer: marketplace
--    students have no institution, so RLS on `students` would hide their row).
create or replace function public.get_student_details()
returns table (
  full_name text, phone text, address text,
  grade text, guardian_name text, guardian_phone text
) language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  return query
  select p.full_name, p.phone, s.address, s.grade, s.guardian_name, s.guardian_phone
  from profiles p
  left join students s on s.profile_id = p.id
  where p.id = v_uid;
end; $$;
grant execute on function public.get_student_details() to authenticated;

-- 3) Save the signed-in student's details (upsert students row + update profile).
create or replace function public.save_student_details(
  p_full_name text, p_phone text, p_address text,
  p_grade text, p_guardian_name text, p_guardian_phone text
) returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_student students;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode='P0001'; end if;
  update profiles set full_name = p_full_name, phone = p_phone where id = v_uid;
  select * into v_student from students where profile_id = v_uid limit 1;
  if v_student.id is null then
    insert into students (profile_id, grade, address, guardian_name, guardian_phone)
      values (v_uid, p_grade, p_address, p_guardian_name, p_guardian_phone);
  else
    update students set grade = p_grade, address = p_address,
      guardian_name = p_guardian_name, guardian_phone = p_guardian_phone
     where id = v_student.id;
  end if;
end; $$;
grant execute on function public.save_student_details(text,text,text,text,text,text) to authenticated;

-- 4) Confirm the caller's own PENDING booking (simulated payment success).
create or replace function public.pay_booking(p_booking_id uuid)
returns bookings language plpgsql security definer set search_path = public as $$
declare v_student students; v_booking bookings;
begin
  select * into v_student from students where profile_id = auth.uid() limit 1;
  if v_student.id is null then raise exception 'No student record for this account' using errcode='P0001'; end if;
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if v_booking.student_id <> v_student.id then raise exception 'Not your booking' using errcode='P0003'; end if;
  if v_booking.status = 'CONFIRMED' then return v_booking; end if;
  if v_booking.status <> 'PENDING' then
    raise exception 'Only a held (pending) seat can be paid for' using errcode='P0005'; end if;
  update bookings set status = 'CONFIRMED' where id = p_booking_id returning * into v_booking;
  return v_booking;
end; $$;
grant execute on function public.pay_booking(uuid) to authenticated;
