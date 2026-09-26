-- 0119_agency_remove_student_refund.sql (idempotent — requires 0029, 0112, 0115)
--
-- Fix (HIGH): removing an onboarded student from the agency's Manage Students
-- list ran `reject_booking` on ALL their active bookings — including CONFIRMED
-- (necessarily PAID) ones. reject_booking just flips the booking to REJECTED and
-- frees the seat with NO refund and no `payments.refund_status` record, so a
-- rider who paid real UPI money lost it silently, bypassing the refund system
-- (0112–0115).
--
-- This adds `agency_remove_student_booking`, which the agency CAN call
-- (agency_owns_booking gated — cancel_booking is caller/can_act_for_student
-- gated and unusable by an agency). For a PAID seat it does exactly what a
-- rider-initiated paid cancellation does: flag a refund request and HOLD the
-- seat until a SUPER_ADMIN processes the refund (process_refund then frees it).
-- Unpaid (PENDING) bookings are rejected immediately as before.

create or replace function public.agency_remove_student_booking(p_booking_id uuid)
returns bookings language plpgsql security definer set search_path = public as $$
declare v_booking bookings; v_paid boolean;
begin
  if not public.agency_owns_booking(p_booking_id) then
    raise exception 'Not your booking' using errcode='P0003'; end if;
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.id is null then
    raise exception 'Booking not found' using errcode='P0002'; end if;
  if v_booking.status in ('CANCELLED','REJECTED') then return v_booking; end if;

  -- Verified UPI payment on this seat?
  select exists(select 1 from payments where booking_id = p_booking_id and status = 'PAID')
    into v_paid;

  if v_paid then
    -- Paid seat: never silently forfeit. Flag a refund request for the admin and
    -- HOLD the seat (status unchanged) until process_refund finalizes it — the
    -- same behaviour as a rider-initiated paid cancellation (0115). Idempotent.
    if v_booking.cancel_requested_at is not null then return v_booking; end if;
    update bookings
       set cancel_requested_at = now(), cancel_cause = 'AGENCY'
     where id = p_booking_id
     returning * into v_booking;
    update payments set refund_status = 'REQUESTED', updated_at = now()
     where booking_id = p_booking_id and status = 'PAID'
       and refund_status in ('NONE', 'DECLINED');
    return v_booking; -- seat held pending refund
  else
    update bookings set status = 'REJECTED', cancel_cause = 'AGENCY'
     where id = p_booking_id and status in ('PENDING','CONFIRMED')
     returning * into v_booking;
    return v_booking; -- trigger frees the seat (REJECTED is not active)
  end if;
end; $$;
grant execute on function public.agency_remove_student_booking(uuid) to authenticated;
