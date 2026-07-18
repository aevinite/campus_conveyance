-- 0033_pay_booking_race.sql (idempotent — requires 0032_approval_then_payment)
-- Fix the pay_booking double-payment race, layered on the approval-first flow.
--
-- pay_booking read the booking with a plain SELECT (no row lock) and guarded
-- double-payment only with an in-memory `if is_paid`. Under READ COMMITTED, two
-- concurrent "Pay" clicks both saw is_paid=false, both updated, and both INSERTed
-- a PAID payments row → the student was charged twice and revenue was inflated.
--
-- Two independent defenses (either alone stops the dup; together airtight):
--   1) A UNIQUE index on payments(booking_id) — the DB physically refuses a
--      second payment row per booking.
--   2) pay_booking locks the booking FOR UPDATE and re-checks is_paid under the
--      lock, so the second caller serializes behind the first and bails out.
--
-- Keeps the 0032 approval-first semantics intact: only an APPROVED, unexpired
-- request can be paid, and paying CONFIRMS the seat.

-- 1) Collapse any pre-existing duplicate payment rows (keep the earliest per
--    booking) so the unique index can build, then enforce one-per-booking.
--    booking_id is nullable (set null when a booking is deleted), so the index is
--    partial — multiple null-booking payment rows remain allowed.
delete from payments p
 using payments dup
 where p.booking_id is not null
   and p.booking_id = dup.booking_id
   and (dup.created_at, dup.id) < (p.created_at, p.id);

create unique index if not exists uq_payments_booking_id
  on payments (booking_id)
  where booking_id is not null;

-- 2) pay_booking: 0032's approval-flow logic + FOR UPDATE row lock + ON CONFLICT.
create or replace function public.pay_booking(p_booking_id uuid)
returns bookings language plpgsql security definer set search_path = public as $$
declare v_student students; v_booking bookings; v_price bigint;
begin
  select * into v_student from students where profile_id = auth.uid() limit 1;
  if v_student.id is null then raise exception 'No student record for this account' using errcode='P0001'; end if;

  -- FOR UPDATE serializes concurrent pay clicks on the same booking: a second
  -- caller blocks here until the first commits, then re-reads the now-paid row
  -- (READ COMMITTED re-evaluates the locked row) and returns without charging.
  select * into v_booking from bookings where id = p_booking_id for update;
  if v_booking.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if v_booking.student_id <> v_student.id then raise exception 'Not your booking' using errcode='P0003'; end if;
  if v_booking.is_paid then return v_booking; end if; -- already paid: no double charge
  if v_booking.status <> 'PENDING' then
    raise exception 'Only a held seat can be paid for' using errcode='P0005'; end if;
  if v_booking.approved_at is null then
    raise exception 'Waiting for agency approval — you can pay as soon as the agency approves your request.'
      using errcode = 'P0009';
  end if;
  if v_booking.expires_at is not null and v_booking.expires_at < now() then
    -- Refuse only — an UPDATE here would be rolled back by this very RAISE;
    -- the expire_stale_holds() sweep cancels the lapsed booking.
    raise exception 'Your payment window expired — please reserve the seat again'
      using errcode = 'P0008';
  end if;

  select price_cents into v_price from routes where id = v_booking.route_id;
  update bookings set is_paid = true, paid_at = now(), expires_at = null, status = 'CONFIRMED'
   where id = p_booking_id and not is_paid returning * into v_booking;
  -- Defensive: if the row was already flipped to paid, the UPDATE matches nothing
  -- → re-read and return without inserting a second payment.
  if v_booking.id is null then
    select * into v_booking from bookings where id = p_booking_id;
    return v_booking;
  end if;

  -- ON CONFLICT is the final backstop behind the unique index.
  insert into payments (institution_id, booking_id, amount_cents, currency, status)
  values (v_booking.institution_id, v_booking.id, coalesce(v_price, 0), 'INR', 'PAID')
  on conflict (booking_id) where booking_id is not null do nothing;

  return v_booking;
end; $$;
grant execute on function public.pay_booking(uuid) to authenticated;
