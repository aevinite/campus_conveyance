-- 0122_audit_fixes_batch2.sql (idempotent — requires 0086, 0103, 0107, 0109, 0115)
--
-- Second audit batch (2026-09-27). Seven RPC changes behind reported bugs:
--
--  #2  check_booking_status now returns expires_at, so the "verifying payment"
--      screen can reopen the pay panel with a FRESH countdown when the admin
--      rejects the UTR (payment_status flips to REJECTED, a new 20-min window
--      is set by verify_upi_payment).
--  #3  cancel_booking now treats a SUBMITTED (money-sent, awaiting-verify) UPI
--      payment as money-at-risk: it HOLDS the seat + files a refund request,
--      instead of cancelling it as "unpaid" with no payout captured.
--  #5  parent_children / parent_children_bookings / parent_child_active_booking
--      now surface cancel_requested_at (+ payment_status), so the parent
--      dashboard, child hub and manage-booking page can show "Refund pending"
--      and stop offering a live "Cancel" on an already-requested booking.
--  #7  driver_skip_stop now re-notifies riders who were ALREADY redirected to
--      the stop being skipped (a chain of skips), not just that stop's own
--      riders — so nobody is stranded waiting at a stop the bus now rolls past.
--  #8  driver_reset_stop now notifies riders when a SKIP is undone, so riders
--      told to walk to the next stop learn the bus will stop at the original
--      spot after all.

-- ===========================================================================
-- #2 — check_booking_status: add expires_at (return type changes → drop first).
-- ===========================================================================
drop function if exists public.check_booking_status(uuid);
create or replace function public.check_booking_status(p_booking_id uuid)
returns table (status text, payment_status text, route_id uuid, expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.status::text, b.payment_status, b.route_id, b.expires_at
  from bookings b
  where b.id = p_booking_id
    and public.can_act_for_student(b.student_id);
$$;
grant execute on function public.check_booking_status(uuid) to authenticated;

-- ===========================================================================
-- #3 — cancel_booking: a SUBMITTED UPI payment is money-at-risk. Hold the seat
-- and file a refund request (same as a verified PAID cancel) rather than
-- cancelling it as unpaid with no payout captured. Redefines 0115.
-- ===========================================================================
create or replace function public.cancel_booking(
  p_booking_id uuid, p_reason text default null, p_refund jsonb default null
) returns bookings language plpgsql security definer set search_path = public as $$
declare v_booking bookings; v_paid boolean;
begin
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if not public.can_act_for_student(v_booking.student_id) then
    raise exception 'Not your booking' using errcode='P0003'; end if;
  if v_booking.status in ('CANCELLED','REJECTED') then return v_booking; end if;

  -- Money is at risk if a payment was verified (PAID) OR the rider has already
  -- sent UPI money and submitted the UTR (payment_status = 'SUBMITTED', the
  -- payment row sits at 'CREATED' awaiting the admin's verification).
  select v_booking.payment_status = 'SUBMITTED'
      or exists(select 1 from payments where booking_id = p_booking_id and status = 'PAID')
    into v_paid;

  if v_paid then
    -- HOLD: don't cancel yet. Record the request + payout details; the seat stays
    -- the rider's until the admin processes the refund. Ignore a double request.
    if v_booking.cancel_requested_at is not null then return v_booking; end if;
    update bookings
       set cancel_requested_at = now(),
           cancel_cause   = 'STUDENT',
           cancel_reason  = nullif(btrim(coalesce(p_reason, '')), ''),
           refund_details = p_refund
     where id = p_booking_id
     returning * into v_booking;
    -- Flag whatever payment row exists (verified PAID, or a submitted 'CREATED'
    -- awaiting verification) so it lands in the admin refunds queue.
    update payments set refund_status = 'REQUESTED', updated_at = now()
     where booking_id = p_booking_id
       and status in ('PAID', 'CREATED')
       and refund_status in ('NONE', 'DECLINED');
    return v_booking; -- status unchanged → seat held
  else
    -- Nothing paid → cancel immediately + free the seat (unchanged behaviour).
    update bookings
       set status = 'CANCELLED', cancel_cause = 'STUDENT',
           cancel_reason  = nullif(btrim(coalesce(p_reason, '')), ''),
           refund_details = p_refund
     where id = p_booking_id
     returning * into v_booking;
    return v_booking; -- trigger updates reserved_seats + promotes the waitlist
  end if;
end; $$;
grant execute on function public.cancel_booking(uuid, text, jsonb) to authenticated;

-- ===========================================================================
-- #7 — driver_skip_stop: also re-notify riders already redirected TO this stop.
-- When several stops are skipped in a row, riders redirected from an earlier
-- skipped stop were told to board here; skipping this stop must send them
-- forward too. That "already redirected here" set is the contiguous run of
-- skipped stops immediately preceding this one (any non-skipped stop between
-- them would have been their redirect target instead).
-- ===========================================================================
create or replace function public.driver_skip_stop(p_route_id uuid, p_stop_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_institution uuid := public.driver_assert_route(p_route_id);
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_stop_name text;
  v_seq int;
  v_next_name text;
  v_barrier_seq int;
  v_body text;
  v_rec record;
begin
  select rs.name, rs.sequence into v_stop_name, v_seq
  from route_stops rs where rs.id = p_stop_id and rs.route_id = p_route_id;
  if v_stop_name is null then
    raise exception 'That stop is not on this route' using errcode = 'P0004';
  end if;

  insert into route_stop_progress
    (institution_id, route_id, stop_id, service_date, status, recorded_by, recorded_at)
  values (v_institution, p_route_id, p_stop_id, v_today, 'SKIPPED', v_uid, now())
  on conflict (route_id, stop_id, service_date)
  do update set status = 'SKIPPED', recorded_by = v_uid, recorded_at = now();

  -- Next stop by sequence that is NOT skipped today (rolls forward past other
  -- skipped stops). The just-skipped stop is excluded by sequence > v_seq.
  select rs.name into v_next_name
  from route_stops rs
  where rs.route_id = p_route_id and rs.sequence > v_seq
    and not exists (
      select 1 from route_stop_progress p
      where p.route_id = p_route_id and p.stop_id = rs.id
        and p.service_date = v_today and p.status = 'SKIPPED')
  order by rs.sequence
  limit 1;

  if v_next_name is not null then
    v_body := 'The bus will not stop at ' || v_stop_name
      || ' today. Please go to the next stop, ' || v_next_name || ', to board.';
  else
    v_body := 'The bus will not stop at ' || v_stop_name
      || ' today. Please contact your service provider for an alternative.';
  end if;

  -- The last NON-skipped stop before this one is the barrier: every stop after it
  -- up to and including this one is skipped today, so riders at any of them are
  -- (now) redirected to v_next_name and must be told.
  select coalesce(max(rs.sequence), -1) into v_barrier_seq
  from route_stops rs
  where rs.route_id = p_route_id and rs.sequence < v_seq
    and not exists (
      select 1 from route_stop_progress p
      where p.route_id = p_route_id and p.stop_id = rs.id
        and p.service_date = v_today and p.status = 'SKIPPED');

  for v_rec in
    select rs.id as stop_id
    from route_stops rs
    where rs.route_id = p_route_id
      and rs.sequence > v_barrier_seq and rs.sequence <= v_seq
  loop
    perform public.notify_stop_riders(
      p_route_id, v_rec.stop_id, v_institution, 'Pickup point changed', v_body);
  end loop;

  return v_next_name;
end; $$;
grant execute on function public.driver_skip_stop(uuid, uuid) to authenticated;

-- ===========================================================================
-- #8 — driver_reset_stop: when a SKIP is undone, tell riders the bus will stop
-- at the original spot after all. Riders at this stop AND any earlier stops that
-- were redirected past it (the contiguous skipped run before it) were told to
-- walk to a later stop; they now board here. A NEXT reset stays silent (it only
-- corrects the driver's own "heading to" marker).
-- ===========================================================================
create or replace function public.driver_reset_stop(p_route_id uuid, p_stop_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_institution uuid := public.driver_assert_route(p_route_id);
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_prev_status text;
  v_stop_name text;
  v_seq int;
  v_barrier_seq int;
  v_body text;
  v_rec record;
begin
  select status into v_prev_status from route_stop_progress
  where route_id = p_route_id and stop_id = p_stop_id and service_date = v_today;

  delete from route_stop_progress
  where route_id = p_route_id and stop_id = p_stop_id and service_date = v_today;

  -- Only an undone SKIP needs a rider notice (undoing a NEXT is silent).
  if v_prev_status is distinct from 'SKIPPED' then return; end if;

  select rs.name, rs.sequence into v_stop_name, v_seq
  from route_stops rs where rs.id = p_stop_id and rs.route_id = p_route_id;
  if v_stop_name is null then return; end if;

  v_body := 'Update: the bus will now stop at ' || v_stop_name
    || ' after all. Please board at ' || v_stop_name || '.';

  -- Same contiguous-skipped-run logic as the skip path: riders at earlier stops
  -- that were redirected past this one now board here again.
  select coalesce(max(rs.sequence), -1) into v_barrier_seq
  from route_stops rs
  where rs.route_id = p_route_id and rs.sequence < v_seq
    and not exists (
      select 1 from route_stop_progress p
      where p.route_id = p_route_id and p.stop_id = rs.id
        and p.service_date = v_today and p.status = 'SKIPPED');

  for v_rec in
    select rs.id as stop_id
    from route_stops rs
    where rs.route_id = p_route_id
      and rs.sequence > v_barrier_seq and rs.sequence <= v_seq
  loop
    perform public.notify_stop_riders(
      p_route_id, v_rec.stop_id, v_institution, 'Pickup point restored', v_body);
  end loop;
end; $$;
grant execute on function public.driver_reset_stop(uuid, uuid) to authenticated;

-- ===========================================================================
-- #5 — parent RPCs surface cancel_requested_at / payment_status so the parent
-- surfaces can show "Refund pending" (and not re-offer Cancel). All three
-- change their return type → drop first.
-- ===========================================================================

-- (a) parent_children — the child hub reads active_cancel_requested_at.
drop function if exists public.parent_children();
create or replace function public.parent_children()
returns table (student_id uuid, full_name text, email text, phone text,
               grade text, address text, institution_id uuid, institution_name text,
               managed boolean, active_booking_id uuid, active_status text,
               active_route_id uuid, active_route_name text,
               active_payment_status text, active_cancel_requested_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id,
         coalesce(pr.full_name, s.full_name),
         coalesce(pr.email, s.email),
         coalesce(pr.phone, s.phone),
         s.grade, s.address, s.institution_id, i.name,
         (s.profile_id is null) as managed,
         ab.id, ab.status::text, ab.route_id, r.name,
         ab.payment_status, ab.cancel_requested_at
  from parent_students ps
  join parents pa on pa.id = ps.parent_id and pa.profile_id = auth.uid()
  join students s on s.id = ps.student_id
  left join institutions i on i.id = s.institution_id
  left join lateral (
    select b.id, b.status, b.route_id, b.payment_status, b.cancel_requested_at
    from bookings b
    where b.student_id = s.id and b.status in ('PENDING','CONFIRMED','WAITLISTED')
    order by b.created_at desc limit 1
  ) ab on true
  left join routes r on r.id = ab.route_id
  left join profiles pr on pr.id = s.profile_id
  order by coalesce(pr.full_name, s.full_name) nulls last;
$$;
grant execute on function public.parent_children() to authenticated;

-- (b) parent_children_bookings — the parent dashboard bookings list + pass card.
drop function if exists public.parent_children_bookings();
create or replace function public.parent_children_bookings()
returns table (booking_id uuid, student_id uuid, student_name text,
               route_name text, institution_name text, status text,
               is_paid boolean, created_at timestamptz, pickup_name text,
               departure_time time, bus_number text,
               driver_name text, driver_phone text, driver_changed boolean,
               route_id uuid, billing_period text, paid_at timestamptz,
               payment_status text, cancel_requested_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.id, s.id, coalesce(pr.full_name, s.full_name, b.student_name),
         coalesce(r.name, r.start_location), i.name, b.status::text,
         b.is_paid, b.created_at, st.name,
         r.departure_time, v.bus_number,
         coalesce(dc.driver_name, v.driver_name),
         coalesce(dc.driver_phone, v.driver_phone),
         (dc.id is not null),
         r.id, b.billing_period::text, b.paid_at,
         b.payment_status, b.cancel_requested_at
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

-- (c) parent_child_active_booking — the manage-booking page reads
--     cancel_requested_at so it can lock into "Refund pending".
drop function if exists public.parent_child_active_booking(uuid);
create or replace function public.parent_child_active_booking(p_student_id uuid)
returns table (booking_id uuid, status text, is_paid boolean,
               approved_at timestamptz, expires_at timestamptz,
               pickup_stop_id uuid, billing_period text, payment_status text,
               route_id uuid, route_name text, cancel_requested_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.id, b.status::text, b.is_paid, b.approved_at, b.expires_at,
         b.pickup_stop_id, b.billing_period::text, b.payment_status, b.route_id, r.name,
         b.cancel_requested_at
  from bookings b
  left join routes r on r.id = b.route_id
  where public.can_act_for_student(p_student_id)
    and b.student_id = p_student_id
    and b.status in ('PENDING','CONFIRMED','WAITLISTED')
  order by b.created_at desc
  limit 1;
$$;
grant execute on function public.parent_child_active_booking(uuid) to authenticated;
