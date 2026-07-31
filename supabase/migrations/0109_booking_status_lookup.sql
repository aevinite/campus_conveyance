-- 0109_booking_status_lookup.sql (idempotent — requires 0103, 0107)
--
-- A tiny read RPC the payment screen polls after the rider submits their UTR:
-- while the booking is "verifying", it checks whether the admin has confirmed it
-- yet, so the client can show a "Booking confirmed" popup and send the rider to
-- the live-tracking home. Authorized to the rider themselves OR a linked parent
-- (reuse can_act_for_student), so it works for both the student and parent flows.

-- Named check_booking_status (NOT booking_status) to avoid colliding with the
-- `booking_status` enum type, which would make a positional call parse as a cast.
drop function if exists public.booking_status(uuid);
create or replace function public.check_booking_status(p_booking_id uuid)
returns table (status text, payment_status text, route_id uuid)
language sql stable security definer set search_path = public as $$
  select b.status::text, b.payment_status, b.route_id
  from bookings b
  where b.id = p_booking_id
    and public.can_act_for_student(b.student_id);
$$;
grant execute on function public.check_booking_status(uuid) to authenticated;
