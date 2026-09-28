-- 0127_rider_flow_fixes.sql (idempotent — requires 0107, 0122, 0126)
-- Audit round 3, student/parent MEDIUMs:
--   * Re-submitting a UTR reset the 48h hold every time → a rider could hold a
--     seat forever without paying. Now a correction while SUBMITTED keeps the
--     deadline, and a fresh submission (after an admin rejection) is capped at 3.
--   * Paying just as the 10-min window closed lost the money (no way to enter the
--     UTR). A UTR is now accepted for a PAYMENT_TIMEOUT-expired booking for 24h;
--     (or a PENDING hold whose window just lapsed, before the sweep ran); the
--     booking stays/ends cancelled and, once verified, the money is refunded
--     (verify_upi_payment's dead-booking path from 0126, which now tells the rider).
--   * "Renew pass" couldn't work (a CONFIRMED booking never ends and blocks a new
--     one). Riders now renew IN PLACE: pay the next plan (UPI + UTR) in the last
--     7 days / 3-day grace → admin verifies → the same booking's pass is extended
--     from its current end (bookings.pass_start_at). Passes not renewed end 3 days
--     after expiry (end_lapsed_passes cron, cause PASS_ENDED) and free the seat.
--   * A parent's cancel was recorded as the student's ("X cancelled") and the
--     student got no notice. cancel_booking now records PARENT, and booking_notify
--     tells everyone (incl. the student). PASS_ENDED gets its own message too.
-- (Rejecting a UTR clearing a pending refund, and tracking needing an ACTIVE
--  booking, were already fixed in 0126.)

alter table bookings add column if not exists utr_attempts int not null default 0;
-- Start of the CURRENT pass window when it was renewed (null = paid_at/created_at).
alter table bookings add column if not exists pass_start_at timestamptz;

-- Plan length → when the current pass window ends (null for legacy flat plans).
create or replace function public.booking_pass_end(b bookings) returns timestamptz
language sql stable set search_path = public as $$
  select coalesce(b.pass_start_at, b.paid_at, b.created_at) +
         case b.billing_period
           when 'MONTHLY'  then interval '1 month'
           when 'SEMESTER' then interval '6 months'
           when 'YEARLY'   then interval '12 months'
         end;
$$;

-- ===========================================================================
-- submit_upi_payment — capped hold + late UTR for a just-expired hold.
-- ===========================================================================
create or replace function public.submit_upi_payment(p_booking_id uuid, p_utr text)
returns bookings language plpgsql security definer set search_path = public as $$
declare v_booking bookings; v_price bigint; v_ref text; v_late boolean := false;
  v_monthly bigint; v_semester bigint; v_yearly bigint; v_flat bigint;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if v_booking.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if not public.can_act_for_student(v_booking.student_id) then
    raise exception 'Not your booking' using errcode='P0003'; end if;
  if v_booking.is_paid then return v_booking; end if;
  if coalesce(p_utr,'') !~ '^[0-9]{12}$' then
    raise exception 'Enter the 12-digit UPI reference (UTR) exactly as shown in your UPI app' using errcode='P0015'; end if;

  if ((v_booking.status = 'CANCELLED' and v_booking.cancel_cause = 'PAYMENT_TIMEOUT')
      -- window just closed but the every-minute sweep hasn't cancelled it yet
      or (v_booking.status = 'PENDING' and v_booking.expires_at < now()))
     and v_booking.expires_at > now() - interval '24 hours'
     and v_booking.payment_status in ('UNPAID', 'REJECTED') then
    -- Paid right as the window closed: record it so the admin can verify + refund.
    v_late := true;
  else
    if v_booking.status <> 'PENDING' then
      raise exception 'Only a held seat can be paid for' using errcode='P0005'; end if;
    if v_booking.approved_at is null then
      raise exception 'Waiting for approval — you can pay once the request is approved.' using errcode='P0009'; end if;
    if v_booking.expires_at is not null and v_booking.expires_at < now()
       and v_booking.payment_status in ('UNPAID', 'REJECTED') then
      raise exception 'Your payment window expired — please reserve the seat again' using errcode='P0008'; end if;
    if v_booking.payment_status <> 'SUBMITTED' and v_booking.utr_attempts >= 3 then
      raise exception 'Too many payment attempts on this booking — please contact support' using errcode='P0016'; end if;
  end if;

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

  if v_late then
    -- Stays / becomes an expired hold (seat released); the money is refunded once verified.
    update bookings set payment_status = 'SUBMITTED', status = 'CANCELLED',
           cancel_cause = 'PAYMENT_TIMEOUT'
     where id = p_booking_id returning * into v_booking;
  elsif v_booking.payment_status = 'SUBMITTED' then
    -- Correcting the UTR while it's being verified: never extend the deadline.
    return v_booking;
  else
    -- Hold the seat for review (48h) — counted, so a rejected-then-resubmitted
    -- UTR can't keep the seat held indefinitely.
    update bookings
       set payment_status = 'SUBMITTED', expires_at = now() + interval '48 hours',
           utr_attempts = utr_attempts + 1
     where id = p_booking_id returning * into v_booking;
  end if;

  insert into notifications (institution_id, recipient_id, title, body)
  select v_booking.institution_id, p.id, 'UPI payment to verify',
         coalesce(v_booking.student_name, 'A rider') || ' submitted a UPI payment (ref ' || v_ref || ')' ||
         case when v_late then ' after their seat hold expired — verify it, then refund it under Refunds.'
              else ' — verify it in Payments.' end
  from profiles p where p.role = 'SUPER_ADMIN' and coalesce(p.is_deleted, false) = false;

  return v_booking;
end; $$;
grant execute on function public.submit_upi_payment(uuid, text) to authenticated;

-- ===========================================================================
-- verify_upi_payment — 0126 body + tell the rider when verified money for a
-- dead booking is going to be refunded.
-- ===========================================================================
create or replace function public.verify_upi_payment(p_booking_id uuid, p_approve boolean, p_note text default null)
returns bookings language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text; v_booking bookings; v_route text;
  v_note text := nullif(btrim(coalesce(p_note,'')),'');
begin
  select role::text into v_role from profiles where id = v_uid;
  if v_role is distinct from 'SUPER_ADMIN' then
    raise exception 'Only an admin can verify payments' using errcode='P0003'; end if;

  select * into v_booking from bookings where id = p_booking_id for update;
  if v_booking.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if v_booking.is_paid then return v_booking; end if;
  if not exists (select 1 from payments where booking_id = p_booking_id and status = 'CREATED') then
    raise exception 'There is no submitted payment waiting to be verified' using errcode='P0005'; end if;
  select coalesce(r.name, 'your route') into v_route from routes r where r.id = v_booking.route_id;

  if p_approve then
    update payments set status = 'PAID', verified_at = now(), verified_by = v_uid,
           verify_note = v_note, updated_at = now()
     where booking_id = p_booking_id and status = 'CREATED';

    if v_booking.status = 'PENDING' then
      update bookings
         set is_paid = true, paid_at = now(), expires_at = null,
             status = 'CONFIRMED', payment_status = 'PAID'
       where id = p_booking_id returning * into v_booking;
    else
      update bookings set is_paid = true, paid_at = now(), payment_status = 'PAID'
       where id = p_booking_id returning * into v_booking;
      update payments set refund_status = 'REQUESTED', updated_at = now()
       where booking_id = p_booking_id and status = 'PAID'
         and refund_status in ('NONE', 'DECLINED');
      insert into notifications (institution_id, recipient_id, title, body)
      select v_booking.institution_id, pid, 'Payment received — refund on the way',
             'We received your UPI payment for ' || v_route ||
             ', but the seat hold had already ended, so we''re refunding it to you.'
      from (
        select s.profile_id as pid from students s
          where s.id = v_booking.student_id and s.profile_id is not null
        union
        select pa.profile_id from parent_students ps
          join parents pa on pa.id = ps.parent_id
          where ps.student_id = v_booking.student_id and pa.profile_id is not null
      ) t;
    end if;
  else
    update payments set status = 'FAILED', verified_at = now(), verified_by = v_uid,
           verify_note = v_note, updated_at = now(),
           refund_status = case when refund_status = 'REQUESTED' then 'NONE' else refund_status end
     where booking_id = p_booking_id and status = 'CREATED';

    if v_booking.status = 'PENDING' and v_booking.cancel_requested_at is not null then
      update bookings
         set status = case when v_booking.cancel_cause = 'AGENCY'
                           then 'REJECTED'::booking_status else 'CANCELLED'::booking_status end,
             payment_status = 'REJECTED'
       where id = p_booking_id returning * into v_booking;
    elsif v_booking.status = 'PENDING' then
      update bookings
         set payment_status = 'REJECTED', expires_at = now() + interval '10 minutes'
       where id = p_booking_id returning * into v_booking;

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
    else
      update bookings set payment_status = 'REJECTED'
       where id = p_booking_id returning * into v_booking;
    end if;
  end if;

  return v_booking;
end; $$;

-- ===========================================================================
-- cancel_booking — record WHO cancelled (STUDENT vs PARENT). Body from 0122.
-- ===========================================================================
create or replace function public.cancel_booking(
  p_booking_id uuid, p_reason text default null, p_refund jsonb default null
) returns bookings language plpgsql security definer set search_path = public as $$
declare v_booking bookings; v_paid boolean; v_cause text;
begin
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if not public.can_act_for_student(v_booking.student_id) then
    raise exception 'Not your booking' using errcode='P0003'; end if;
  if v_booking.status in ('CANCELLED','REJECTED') then return v_booking; end if;

  v_cause := case when exists (select 1 from students s
                                where s.id = v_booking.student_id and s.profile_id = auth.uid())
                  then 'STUDENT' else 'PARENT' end;

  select v_booking.payment_status = 'SUBMITTED'
      or exists(select 1 from payments where booking_id = p_booking_id and status = 'PAID')
    into v_paid;

  if v_paid then
    if v_booking.cancel_requested_at is not null then return v_booking; end if;
    update bookings
       set cancel_requested_at = now(),
           cancel_cause   = v_cause,
           cancel_reason  = nullif(btrim(coalesce(p_reason, '')), ''),
           refund_details = p_refund
     where id = p_booking_id
     returning * into v_booking;
    update payments set refund_status = 'REQUESTED', updated_at = now()
     where booking_id = p_booking_id
       and status in ('PAID', 'CREATED')
       and refund_status in ('NONE', 'DECLINED');
    return v_booking; -- status unchanged → seat held
  else
    update bookings
       set status = 'CANCELLED', cancel_cause = v_cause,
           cancel_reason  = nullif(btrim(coalesce(p_reason, '')), ''),
           refund_details = p_refund
     where id = p_booking_id
     returning * into v_booking;
    return v_booking;
  end if;
end; $$;
grant execute on function public.cancel_booking(uuid, text, jsonb) to authenticated;

-- ===========================================================================
-- Pass renewals (in place, same booking + seat).
-- ===========================================================================
create table if not exists pass_renewals (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  billing_period billing_period not null,
  amount_cents bigint not null check (amount_cents >= 0),
  upi_utr text not null,
  reference text not null,
  status text not null default 'CREATED' check (status in ('CREATED','PAID','FAILED')),
  submitted_at timestamptz not null default now(),
  verified_at timestamptz,
  verified_by uuid references profiles(id) on delete set null,
  verify_note text,
  period_start timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_pass_renewals_one_pending
  on pass_renewals (booking_id) where status = 'CREATED';
create index if not exists idx_pass_renewals_status on pass_renewals (status, submitted_at);
alter table pass_renewals enable row level security;  -- RPC / service-role only

-- What the Renew screen needs, gated to the rider or a linked parent.
create or replace function public.pass_renewal_info(p_booking_id uuid)
returns table (booking_id uuid, student_id uuid, student_name text, route_id uuid, route_name text,
               billing_period text, pass_end timestamptz, can_renew boolean, reason text,
               pending_period text, pending_utr text, reference text,
               price_monthly_cents bigint, price_semester_cents bigint, price_yearly_cents bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_b bookings; v_end timestamptz; v_ok boolean := true; v_reason text; v_pend pass_renewals;
begin
  select * into v_b from bookings b where b.id = p_booking_id;
  if v_b.id is null or not public.can_act_for_student(v_b.student_id) then return; end if;
  v_end := public.booking_pass_end(v_b);
  select * into v_pend from pass_renewals pr where pr.booking_id = v_b.id and pr.status = 'CREATED';

  if v_b.status <> 'CONFIRMED' or not v_b.is_paid then
    v_ok := false; v_reason := 'Only an active, paid pass can be renewed.';
  elsif v_b.cancel_requested_at is not null then
    v_ok := false; v_reason := 'This booking has a cancellation in progress.';
  elsif v_end is null then
    v_ok := false; v_reason := 'This pass has no plan length — book a new plan from the route page.';
  elsif now() < v_end - interval '7 days' then
    v_ok := false; v_reason := 'You can renew in the last 7 days of your pass.';
  elsif now() > v_end + interval '3 days' then
    v_ok := false; v_reason := 'The renewal grace period has ended.';
  end if;

  return query
  select v_b.id, v_b.student_id, v_b.student_name, r.id, coalesce(r.name, r.start_location),
         v_b.billing_period::text, v_end, v_ok, v_reason,
         v_pend.billing_period::text, v_pend.upi_utr,
         'RN' || upper(left(replace(v_b.id::text, '-', ''), 12)),
         r.price_monthly_cents, r.price_semester_cents, r.price_yearly_cents
  from routes r where r.id = v_b.route_id;
end; $$;
grant execute on function public.pass_renewal_info(uuid) to authenticated;

create or replace function public.submit_pass_renewal(p_booking_id uuid, p_period billing_period, p_utr text)
returns pass_renewals language plpgsql security definer set search_path = public as $$
declare v_b bookings; v_end timestamptz; v_price bigint; v_row pass_renewals; v_ref text;
begin
  select * into v_b from bookings where id = p_booking_id for update;
  if v_b.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if not public.can_act_for_student(v_b.student_id) then
    raise exception 'Not your booking' using errcode='P0003'; end if;
  if v_b.status <> 'CONFIRMED' or not v_b.is_paid or v_b.cancel_requested_at is not null then
    raise exception 'Only an active, paid pass can be renewed' using errcode='P0005'; end if;
  v_end := public.booking_pass_end(v_b);
  if v_end is null or now() < v_end - interval '7 days' or now() > v_end + interval '3 days' then
    raise exception 'Renewal is open in the last 7 days of the pass (and 3 days after it ends)' using errcode='P0017'; end if;
  if coalesce(p_utr,'') !~ '^[0-9]{12}$' then
    raise exception 'Enter the 12-digit UPI reference (UTR) exactly as shown in your UPI app' using errcode='P0015'; end if;
  if (select count(*) from pass_renewals pr where pr.booking_id = p_booking_id and pr.status = 'FAILED'
        and pr.verified_at > now() - interval '7 days') >= 3 then
    raise exception 'Too many failed renewal payments — please contact support' using errcode='P0016'; end if;

  select case p_period when 'MONTHLY' then r.price_monthly_cents
                       when 'SEMESTER' then r.price_semester_cents
                       when 'YEARLY' then r.price_yearly_cents end
    into v_price from routes r where r.id = v_b.route_id;
  if coalesce(v_price, 0) <= 0 then
    raise exception 'This plan isn''t offered on this route' using errcode='P0013'; end if;

  v_ref := 'RN' || upper(left(replace(v_b.id::text, '-', ''), 12));
  -- One pending renewal per booking; re-submitting corrects it in place.
  update pass_renewals set billing_period = p_period, amount_cents = v_price, upi_utr = p_utr,
         submitted_at = now()
   where booking_id = p_booking_id and status = 'CREATED' returning * into v_row;
  if v_row.id is null then
    insert into pass_renewals (booking_id, billing_period, amount_cents, upi_utr, reference)
    values (p_booking_id, p_period, v_price, p_utr, v_ref) returning * into v_row;
  end if;

  insert into notifications (institution_id, recipient_id, title, body)
  select v_b.institution_id, p.id, 'Pass renewal to verify',
         coalesce(v_b.student_name, 'A rider') || ' paid a pass renewal (ref ' || v_ref || ') — verify it in Payments.'
  from profiles p where p.role = 'SUPER_ADMIN' and coalesce(p.is_deleted, false) = false;
  return v_row;
end; $$;
grant execute on function public.submit_pass_renewal(uuid, billing_period, text) to authenticated;

create or replace function public.verify_pass_renewal(p_renewal_id uuid, p_approve boolean, p_note text default null)
returns pass_renewals language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text; v_r pass_renewals; v_b bookings; v_start timestamptz;
  v_route text; v_title text; v_body text; v_note text := nullif(btrim(coalesce(p_note,'')),'');
begin
  select role::text into v_role from profiles where id = v_uid;
  if v_role is distinct from 'SUPER_ADMIN' then
    raise exception 'Only an admin can verify payments' using errcode='P0003'; end if;
  select * into v_r from pass_renewals where id = p_renewal_id for update;
  if v_r.id is null then raise exception 'Renewal not found' using errcode='P0002'; end if;
  if v_r.status <> 'CREATED' then return v_r; end if;
  select * into v_b from bookings where id = v_r.booking_id for update;
  select coalesce(r.name, 'your route') into v_route from routes r where r.id = v_b.route_id;

  if p_approve then
    if v_b.status <> 'CONFIRMED' or v_b.cancel_requested_at is not null then
      raise exception 'This booking is no longer active — reject the renewal and refund the rider by hand'
        using errcode = 'P0005'; end if;
    v_start := greatest(public.booking_pass_end(v_b), now());
    update bookings set billing_period = v_r.billing_period, pass_start_at = v_start
     where id = v_b.id returning * into v_b;
    update pass_renewals set status = 'PAID', verified_at = now(), verified_by = v_uid,
           verify_note = v_note, period_start = v_start
     where id = v_r.id returning * into v_r;
    v_title := 'Bus pass renewed';
    v_body := 'Your pass for ' || v_route || ' is renewed until ' ||
              to_char(public.booking_pass_end(v_b) at time zone 'Asia/Kolkata', 'DD Mon YYYY') || '.';
  else
    update pass_renewals set status = 'FAILED', verified_at = now(), verified_by = v_uid, verify_note = v_note
     where id = v_r.id returning * into v_r;
    v_title := 'Renewal payment could not be verified';
    v_body := 'We could not verify your renewal payment for ' || v_route ||
              '. Please pay again and re-enter the reference.' || coalesce(' Note: ' || v_note, '');
  end if;

  insert into notifications (institution_id, recipient_id, title, body)
  select v_b.institution_id, pid, v_title, v_body
  from (
    select s.profile_id as pid from students s
      where s.id = v_b.student_id and s.profile_id is not null
    union
    select pa.profile_id from parent_students ps
      join parents pa on pa.id = ps.parent_id
      where ps.student_id = v_b.student_id and pa.profile_id is not null
  ) t;
  return v_r;
end; $$;
grant execute on function public.verify_pass_renewal(uuid, boolean, text) to authenticated;

-- End passes that lapsed (3-day grace) with no renewal pending → frees the seat.
create or replace function public.end_lapsed_passes() returns integer
language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  update bookings b set status = 'CANCELLED', cancel_cause = 'PASS_ENDED'
   where b.status = 'CONFIRMED'
     and b.billing_period is not null
     and b.cancel_requested_at is null
     and public.booking_pass_end(b) + interval '3 days' < now()
     and not exists (select 1 from pass_renewals pr where pr.booking_id = b.id and pr.status = 'CREATED');
  get diagnostics v_count = row_count;
  return v_count;
end; $$;
revoke execute on function public.end_lapsed_passes() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'end-lapsed-passes';
    perform cron.schedule('end-lapsed-passes', '10 * * * *', 'select public.end_lapsed_passes();');
  end if;
end $$;

-- Parent dashboard needs the renewed window start (return type changes → drop).
drop function if exists public.parent_children_bookings();
create or replace function public.parent_children_bookings()
returns table (booking_id uuid, student_id uuid, student_name text, route_name text, institution_name text,
               status text, is_paid boolean, created_at timestamptz, pickup_name text,
               departure_time time, bus_number text, driver_name text, driver_phone text,
               driver_changed boolean, route_id uuid, billing_period text, paid_at timestamptz,
               payment_status text, cancel_requested_at timestamptz, pass_start_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.id, s.id, coalesce(pr.full_name, s.full_name, b.student_name),
         coalesce(r.name, r.start_location), i.name, b.status::text,
         b.is_paid, b.created_at, st.name,
         r.departure_time, v.bus_number,
         coalesce(dc.driver_name, v.driver_name),
         coalesce(dc.driver_phone, v.driver_phone),
         (dc.id is not null),
         r.id, b.billing_period::text, b.paid_at,
         b.payment_status, b.cancel_requested_at, b.pass_start_at
  from parent_students ps
  join parents pa on pa.id = ps.parent_id and pa.profile_id = auth.uid()
  join students s on s.id = ps.student_id
  join bookings b on b.student_id = s.id
  join routes r on r.id = b.route_id
  left join institutions i on i.id = r.institution_id
  left join vehicles v on v.id = r.vehicle_id
  left join bus_driver_changes dc
    on dc.vehicle_id = v.id and dc.effective_date = (now() at time zone 'Asia/Kolkata')::date
  left join route_stops st on st.id = b.pickup_stop_id
  left join profiles pr on pr.id = s.profile_id
  order by b.created_at desc;
$$;
grant execute on function public.parent_children_bookings() to authenticated;

-- Agency "Completed payments" includes verified renewals.
create or replace function public.agency_completed_payments(p_agency_id uuid, p_limit integer default null, p_offset integer default 0)
returns table (booking_id uuid, student_name text, student_email text, route_name text, amount_cents bigint,
               upi_utr text, reference text, submitted_at timestamptz, verified_at timestamptz)
language sql stable security definer set search_path = public as $$
  select x.booking_id, x.student_name, x.student_email, x.route_name, x.amount_cents,
         x.upi_utr, x.reference, x.submitted_at, x.verified_at
  from (
    select b.id, b.student_name, b.student_email, r.name,
           p.amount_cents, p.upi_utr, p.reference, p.submitted_at, p.verified_at,
           coalesce(p.verified_at, p.submitted_at, p.created_at) as sort_at
    from payments p
    join bookings b on b.id = p.booking_id
    join routes r on r.id = b.route_id
    where r.agency_id = p_agency_id and p.status = 'PAID'
    union all
    select b.id, b.student_name, b.student_email, r.name,
           pr.amount_cents, pr.upi_utr, pr.reference, pr.submitted_at, pr.verified_at,
           coalesce(pr.verified_at, pr.submitted_at)
    from pass_renewals pr
    join bookings b on b.id = pr.booking_id
    join routes r on r.id = b.route_id
    where r.agency_id = p_agency_id and pr.status = 'PAID'
  ) x (booking_id, student_name, student_email, route_name, amount_cents, upi_utr, reference,
       submitted_at, verified_at, sort_at)
  where exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid())
  order by x.sort_at desc
  limit p_limit offset coalesce(p_offset, 0);
$$;

create or replace function public.agency_completed_payments_count(p_agency_id uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid())
    then (select count(*) from payments p join bookings b on b.id = p.booking_id
            join routes r on r.id = b.route_id
           where r.agency_id = p_agency_id and p.status = 'PAID')
       + (select count(*) from pass_renewals pr join bookings b on b.id = pr.booking_id
            join routes r on r.id = b.route_id
           where r.agency_id = p_agency_id and pr.status = 'PAID')
    else 0 end;
$$;

-- ===========================================================================
-- booking_notify — live body + PARENT cancel (everyone, incl. student) + PASS_ENDED.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.booking_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_route       text;
  v_who         text;
  v_title       text;
  v_body        text;
  v_kind        text;
  v_url         text;
  v_student_pid uuid;
  v_skip_student boolean := false;
  v_rec         record;
begin
  begin
    if tg_op = 'INSERT' then
      if new.status = 'PENDING' then
        v_kind := 'RESERVED';
      elsif new.status = 'WAITLISTED' then
        v_kind := 'WAITLISTED';
      else
        return new;
      end if;
    elsif tg_op = 'UPDATE' then
      if new.status is not distinct from old.status then
        return new;
      elsif new.status = 'CONFIRMED' then
        v_kind := 'CONFIRMED';
      elsif new.status = 'REJECTED' then
        v_kind := 'REJECTED';
      elsif new.status = 'PENDING' and old.status = 'WAITLISTED' then
        v_kind := 'PROMOTED';
      elsif new.status = 'CANCELLED' then
        if new.cancel_cause = 'PAYMENT_TIMEOUT' then
          v_kind := 'EXPIRED';
        elsif new.cancel_cause = 'STUDENT' then
          v_kind := 'CANCELLED_SELF';
        elsif new.cancel_cause = 'PARENT' then
          v_kind := 'CANCELLED_PARENT';
        elsif new.cancel_cause = 'PASS_ENDED' then
          v_kind := 'PASS_ENDED';
        else
          v_kind := 'CANCELLED';
        end if;
      else
        return new;
      end if;
    else
      return new;
    end if;

    select r.name into v_route from routes r where r.id = new.route_id;
    v_route := coalesce(v_route, 'your route');
    v_who := coalesce(nullif(btrim(new.student_name), ''), 'Your child');
    select s.profile_id into v_student_pid from students s where s.id = new.student_id;

    if v_kind = 'RESERVED' then
      v_title := 'Seat reserved — finish payment';
      v_body  := 'Your seat on ' || v_route || ' is held. Complete payment within 10 minutes to confirm it.';
    elsif v_kind = 'WAITLISTED' then
      v_title := 'You''re on the waitlist';
      v_body  := v_route || ' is full right now — you''re on the waitlist and we''ll let you know the moment a seat opens up.';
    elsif v_kind = 'CONFIRMED' then
      v_title := 'Booking confirmed';
      v_body  := 'Your seat on ' || v_route || ' is confirmed. Have a safe ride!';
    elsif v_kind = 'REJECTED' then
      v_title := 'Booking rejected';
      v_body  := 'Your booking for ' || v_route || ' was rejected by the agency. Any payment hold has been released — you can book another route anytime.';
    elsif v_kind = 'PROMOTED' then
      v_title := 'A seat opened up!';
      v_body  := 'Good news — a seat opened on ' || v_route || '. Complete payment within 10 minutes to confirm it before it''s offered to the next person.';
    elsif v_kind = 'EXPIRED' then
      v_title := 'Reservation expired';
      v_body  := 'Your seat hold on ' || v_route || ' expired because payment wasn''t completed in time. The seat has been released — you can book again anytime.';
    elsif v_kind = 'CANCELLED_SELF' then
      v_kind  := 'CANCELLED';
      v_skip_student := true;
      v_title := 'Booking cancelled';
      v_body  := v_who || ' cancelled their booking for ' || v_route || '.';
    elsif v_kind = 'CANCELLED_PARENT' then
      -- A parent cancelled: tell everyone, including the student.
      v_kind  := 'CANCELLED';
      v_title := 'Booking cancelled';
      v_body  := 'A parent cancelled ' || v_who || '''s booking for ' || v_route || '.';
    elsif v_kind = 'PASS_ENDED' then
      v_kind  := 'CANCELLED';
      v_title := 'Bus pass ended';
      v_body  := 'The bus pass for ' || v_route || ' has ended and the seat was released. Book again anytime to keep riding.';
    else
      v_title := 'Booking cancelled';
      v_body  := 'Your booking for ' || v_route || ' was cancelled and the seat released.';
    end if;

    v_url := '/student/bookings';

    for v_rec in
      select s.profile_id as pid, pr.email as email
      from students s
      left join profiles pr on pr.id = s.profile_id
      where s.id = new.student_id and s.profile_id is not null
      union
      select pa.profile_id, pr.email
      from parent_students ps
      join parents pa on pa.id = ps.parent_id
      left join profiles pr on pr.id = pa.profile_id
      where ps.student_id = new.student_id and pa.profile_id is not null
    loop
      if v_skip_student and v_rec.pid = v_student_pid then
        continue;
      end if;

      insert into notifications (institution_id, recipient_id, title, body)
      values (new.institution_id, v_rec.pid, v_title, v_body);

      if v_rec.email is not null then
        insert into email_outbox (recipient_id, to_email, kind, title, body, booking_id)
        values (v_rec.pid, v_rec.email, v_kind, v_title, v_body, new.id);
      end if;

      insert into push_outbox (recipient_id, kind, title, body, url, booking_id)
      values (v_rec.pid, v_kind, v_title, v_body, v_url, new.id);
    end loop;

  exception when others then
    raise warning 'booking_notify failed for booking %: %', new.id, sqlerrm;
  end;

  return new;
end; $function$;

notify pgrst, 'reload schema';
