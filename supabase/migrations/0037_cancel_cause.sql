-- 0037_cancel_cause.sql (idempotent — requires 0025 + 0029)
-- Record WHY a booking was cancelled, so the student timeline stops mislabelling
-- a voluntary cancellation as "payment wasn't received in time".
--
-- Both a student cancel and the payment-window sweep set status=CANCELLED, so
-- after the fact they were indistinguishable and the UI guessed "timeout" for
-- any approved+unpaid cancel. Now the cause is stamped at cancel time:
--   'STUDENT'          → the rider cancelled it themselves
--   'PAYMENT_TIMEOUT'  → the 20-minute payment window lapsed (sweep)

alter table bookings add column if not exists cancel_cause text;

-- cancel_booking (student-initiated) — tag the cause.
create or replace function public.cancel_booking(p_booking_id uuid)
returns bookings language plpgsql security definer set search_path = public as $$
declare v_student students; v_booking bookings;
begin
  select * into v_student from students where profile_id = auth.uid() limit 1;
  if v_student.id is null then raise exception 'No student record for this account' using errcode='P0001'; end if;
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if v_booking.student_id <> v_student.id then raise exception 'Not your booking' using errcode='P0003'; end if;
  if v_booking.status in ('CANCELLED','REJECTED') then return v_booking; end if;
  update bookings set status='CANCELLED', cancel_cause='STUDENT'
    where id = p_booking_id returning * into v_booking;
  return v_booking; -- trigger updates reserved_seats + promotes the waitlist
end; $$;
grant execute on function public.cancel_booking(uuid) to authenticated;

-- expire_stale_holds (payment-window sweep) — tag the timeout.
create or replace function public.expire_stale_holds() returns integer
language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  update bookings set status = 'CANCELLED', cancel_cause = 'PAYMENT_TIMEOUT'
   where status = 'PENDING'
     and coalesce(is_paid, false) = false
     and expires_at is not null
     and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end; $$;
grant execute on function public.expire_stale_holds() to authenticated;
