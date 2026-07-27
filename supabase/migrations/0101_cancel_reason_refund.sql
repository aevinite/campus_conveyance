-- 0101_cancel_reason_refund.sql (idempotent — requires 0037)
--
-- When a student cancels a booking they now fill a short form: WHY they're
-- cancelling (reason) and WHERE to send any refund (UPI or bank details). Store
-- both on the booking so the agency can action the refund.
--
-- cancel_booking gains two optional params. Its argument signature changes, so
-- the old 1-arg function is DROPPED first (create-or-replace can't change the
-- signature — it would leave two overloads and make the PostgREST call
-- ambiguous). The new params default to NULL, so a call passing only
-- p_booking_id still resolves to this one function.

alter table bookings add column if not exists cancel_reason  text;
alter table bookings add column if not exists refund_details jsonb;

drop function if exists public.cancel_booking(uuid);

create or replace function public.cancel_booking(
  p_booking_id uuid,
  p_reason     text  default null,
  p_refund     jsonb default null
)
returns bookings language plpgsql security definer set search_path = public as $$
declare v_student students; v_booking bookings;
begin
  select * into v_student from students where profile_id = auth.uid() limit 1;
  if v_student.id is null then raise exception 'No student record for this account' using errcode='P0001'; end if;
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if v_booking.student_id <> v_student.id then raise exception 'Not your booking' using errcode='P0003'; end if;
  if v_booking.status in ('CANCELLED','REJECTED') then return v_booking; end if;
  update bookings
     set status='CANCELLED',
         cancel_cause='STUDENT',
         cancel_reason  = nullif(btrim(coalesce(p_reason, '')), ''),
         refund_details = p_refund
   where id = p_booking_id
   returning * into v_booking;
  return v_booking; -- trigger updates reserved_seats + promotes the waitlist
end; $$;
grant execute on function public.cancel_booking(uuid, text, jsonb) to authenticated;
