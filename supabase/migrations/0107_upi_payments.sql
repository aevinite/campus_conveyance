-- 0107_upi_payments.sql (idempotent — requires 0090, 0093, 0101, 0103)
--
-- REAL UPI PAYMENTS via a personal platform VPA + MANUAL UTR verification
-- (user decision 2026-07-31: no payment gateway).
--
-- Payments were 100% mock: pay_booking flipped a booking to CONFIRMED with no
-- charge. With a personal UPI VPA and no gateway there is NO server callback, so
-- the seat cannot be auto-confirmed. Instead:
--   1. The family pays to the platform's UPI (QR / upi:// deep link, amount
--      pre-filled) and submits the 12-digit UTR  -> submit_upi_payment.
--   2. The booking goes to payment_status='SUBMITTED' and the seat is HELD (its
--      hold window is extended so it can't lapse mid-review), status stays PENDING.
--   3. A SUPER_ADMIN checks the money arrived and approves -> verify_upi_payment
--      confirms the seat (existing booking_notify fires the confirmed alerts) or
--      rejects it (booking reopened for re-payment).
--
-- The seat is NEVER confirmed on the client's word — only verify_upi_payment
-- (SUPER_ADMIN) can confirm. UPI config (the platform VPA) lives in app_settings.

-- ---------------------------------------------------------------------------
-- (1) payments: capture the UPI submission + the verification audit trail.
--     (The vestigial razorpay_* columns are left untouched.) Reuse the existing
--     payment_status enum values: CREATED = awaiting verification, PAID =
--     verified, FAILED = rejected — so no enum ALTER (avoids the in-txn hazard).
-- ---------------------------------------------------------------------------
alter table payments add column if not exists upi_utr     text;
alter table payments add column if not exists payee_vpa   text;
alter table payments add column if not exists reference   text;
alter table payments add column if not exists method      text default 'UPI';
alter table payments add column if not exists submitted_at timestamptz;
alter table payments add column if not exists verified_at  timestamptz;
alter table payments add column if not exists verified_by  uuid references profiles(id) on delete set null;
alter table payments add column if not exists verify_note  text;

-- ---------------------------------------------------------------------------
-- (2) bookings.payment_status — the UI's source of truth for the payment step,
--     kept distinct from bookings.status (which stays PENDING while verifying so
--     the seat keeps counting toward capacity + the one-active-per-child rule).
-- ---------------------------------------------------------------------------
alter table bookings add column if not exists payment_status text not null default 'UNPAID';
do $$ begin
  alter table bookings add constraint bookings_payment_status_chk
    check (payment_status in ('UNPAID','SUBMITTED','PAID','REJECTED'));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- (3) submit_upi_payment: the family reports they paid, with the 12-digit UTR.
--     Records the submission and holds the seat for review. Authorized to the
--     student themselves OR a linked parent (reuse can_act_for_student, 0103).
-- ---------------------------------------------------------------------------
create or replace function public.submit_upi_payment(p_booking_id uuid, p_utr text)
returns bookings language plpgsql security definer set search_path = public as $$
declare v_booking bookings; v_price bigint; v_ref text;
  v_monthly bigint; v_semester bigint; v_yearly bigint; v_flat bigint;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if v_booking.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if not public.can_act_for_student(v_booking.student_id) then
    raise exception 'Not your booking' using errcode='P0003'; end if;
  if v_booking.is_paid then return v_booking; end if;
  if v_booking.status <> 'PENDING' then
    raise exception 'Only a held seat can be paid for' using errcode='P0005'; end if;
  if v_booking.approved_at is null then
    raise exception 'Waiting for approval — you can pay once the request is approved.' using errcode='P0009'; end if;
  if v_booking.expires_at is not null and v_booking.expires_at < now()
     and v_booking.payment_status = 'UNPAID' then
    raise exception 'Your payment window expired — please reserve the seat again' using errcode='P0008'; end if;
  if coalesce(p_utr,'') !~ '^[0-9]{12}$' then
    raise exception 'Enter the 12-digit UPI reference (UTR) exactly as shown in your UPI app' using errcode='P0015'; end if;

  -- Amount = the plan the booking was made under (same rule as pay_booking).
  select price_monthly_cents, price_semester_cents, price_yearly_cents, price_cents
    into v_monthly, v_semester, v_yearly, v_flat from routes where id = v_booking.route_id;
  v_price := case v_booking.billing_period
    when 'MONTHLY'  then v_monthly when 'SEMESTER' then v_semester
    when 'YEARLY'   then v_yearly  else null end;
  if v_price is null then v_price := v_flat; end if;

  v_ref := 'CC' || upper(left(replace(v_booking.id::text, '-', ''), 12));

  insert into payments (institution_id, booking_id, amount_cents, currency, status,
                        method, upi_utr, reference, submitted_at)
  values (v_booking.institution_id, v_booking.id, coalesce(v_price,0), 'INR', 'CREATED',
          'UPI', p_utr, v_ref, now())
  on conflict (booking_id) where booking_id is not null do update
    set amount_cents = excluded.amount_cents, status = 'CREATED', method = 'UPI',
        upi_utr = excluded.upi_utr, reference = excluded.reference,
        submitted_at = now(), verified_at = null, verified_by = null, verify_note = null,
        updated_at = now();

  -- Hold the seat for review: mark submitted + extend the window to 48h so the
  -- pg_cron sweep still reclaims an abandoned/fraudulent submission, but a real
  -- payer is not dropped while the admin verifies.
  update bookings
     set payment_status = 'SUBMITTED', expires_at = now() + interval '48 hours'
   where id = p_booking_id returning * into v_booking;

  -- Ping the platform admins to verify.
  insert into notifications (institution_id, recipient_id, title, body)
  select v_booking.institution_id, p.id, 'UPI payment to verify',
         coalesce(v_booking.student_name, 'A rider') || ' submitted a UPI payment (ref ' || v_ref || ') — verify it in Payments.'
  from profiles p where p.role = 'SUPER_ADMIN' and coalesce(p.is_deleted, false) = false;

  return v_booking;
end; $$;
grant execute on function public.submit_upi_payment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- (4) verify_upi_payment: SUPER_ADMIN confirms (money arrived) or rejects. This
--     is the ONLY path that confirms a UPI seat.
-- ---------------------------------------------------------------------------
create or replace function public.verify_upi_payment(p_booking_id uuid, p_approve boolean, p_note text default null)
returns bookings language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text; v_booking bookings; v_route text;
begin
  select role::text into v_role from profiles where id = v_uid;
  if v_role is distinct from 'SUPER_ADMIN' then
    raise exception 'Only an admin can verify payments' using errcode='P0003'; end if;

  select * into v_booking from bookings where id = p_booking_id for update;
  if v_booking.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if v_booking.is_paid then return v_booking; end if;

  if p_approve then
    update payments set status = 'PAID', verified_at = now(), verified_by = v_uid,
           verify_note = nullif(btrim(coalesce(p_note,'')),''), updated_at = now()
     where booking_id = p_booking_id;
    -- Confirm the seat — the booking_notify trigger fires the confirmed
    -- bell/email/push to the student + linked parents on this status change.
    update bookings
       set is_paid = true, paid_at = now(), expires_at = null,
           status = 'CONFIRMED', payment_status = 'PAID'
     where id = p_booking_id returning * into v_booking;
  else
    update payments set status = 'FAILED', verified_at = now(), verified_by = v_uid,
           verify_note = nullif(btrim(coalesce(p_note,'')),''), updated_at = now()
     where booking_id = p_booking_id;
    -- Reopen the seat for another attempt (fresh 20-min window), stays PENDING.
    update bookings
       set payment_status = 'REJECTED', expires_at = now() + interval '20 minutes'
     where id = p_booking_id returning * into v_booking;

    select coalesce(r.name, 'your route') into v_route from routes r where r.id = v_booking.route_id;
    insert into notifications (institution_id, recipient_id, title, body)
    select v_booking.institution_id, pid, 'Payment could not be verified',
           'We could not verify your UPI payment for ' || v_route ||
           '. Please pay again and re-enter the reference to confirm the seat.'
    from (
      select s.profile_id as pid from students s
        where s.id = v_booking.student_id and s.profile_id is not null
      union
      select pa.profile_id from parent_students ps
        join parents pa on pa.id = ps.parent_id
        where ps.student_id = v_booking.student_id and pa.profile_id is not null
    ) t;
  end if;

  return v_booking;
end; $$;
grant execute on function public.verify_upi_payment(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- (5) parent_child_active_booking — add payment_status so the parent booking
--     page can open straight on the "verifying" state for a submitted payment.
--     (Redefines the 0103 version; same columns + payment_status.)
-- ---------------------------------------------------------------------------
drop function if exists public.parent_child_active_booking(uuid);
create or replace function public.parent_child_active_booking(p_student_id uuid)
returns table (booking_id uuid, status text, is_paid boolean,
               approved_at timestamptz, expires_at timestamptz,
               pickup_stop_id uuid, billing_period text, payment_status text,
               route_id uuid, route_name text)
language sql stable security definer set search_path = public as $$
  select b.id, b.status::text, b.is_paid, b.approved_at, b.expires_at,
         b.pickup_stop_id, b.billing_period::text, b.payment_status, b.route_id, r.name
  from bookings b
  left join routes r on r.id = b.route_id
  where public.can_act_for_student(p_student_id)
    and b.student_id = p_student_id
    and b.status in ('PENDING','CONFIRMED','WAITLISTED')
  order by b.created_at desc
  limit 1;
$$;
grant execute on function public.parent_child_active_booking(uuid) to authenticated;
