-- 0126_money_and_tracking_fixes.sql (idempotent — requires 0029, 0044, 0107, 0108, 0112, 0115, 0119, 0122)
-- Audit round 3, money + live-tracking HIGHs:
--   #5 verify_upi_payment approved a payment on a CANCELLED/REJECTED (e.g. hold-
--      timeout) booking by flipping it back to CONFIRMED with no seat check →
--      oversell. Now only a PENDING booking (whose seat is still held) confirms;
--      money received for a dead booking is recorded PAID and sent to refunds.
--   #6 reject_booking + agency_remove_student_booking treated a SUBMITTED (money
--      sent, awaiting verification) booking as unpaid → rejected with no refund.
--      Both now hold the seat + file a refund request, like cancel_booking (0122).
--   #7 The refund queue accepted requests on UNVERIFIED payments (any 12-digit
--      UTR). process_refund now refuses to pay out until the payment is verified
--      PAID; rejecting the UTR of a cancel-requested booking finalizes the cancel
--      with no refund (the money never arrived).
--   #8 bus_live_location only answered booked riders/parents → admin, agency and
--      campus maps never showed a bus. Also now requires an ACTIVE booking.
--   #9 A killed driver app left driver_locations.is_online = true forever, so the
--      next app open auto-resumed GPS streaming. driver_status now reports online
--      only while fresh, and a cron clears stale online flags.

-- ===========================================================================
-- #5 / #7 — verify_upi_payment
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

  if p_approve then
    update payments set status = 'PAID', verified_at = now(), verified_by = v_uid,
           verify_note = v_note, updated_at = now()
     where booking_id = p_booking_id and status = 'CREATED';

    if v_booking.status = 'PENDING' then
      -- Seat still held → confirm it. A pending cancel/refund request (rider or
      -- agency cancelled while verifying) stays REQUESTED and is now payable.
      update bookings
         set is_paid = true, paid_at = now(), expires_at = null,
             status = 'CONFIRMED', payment_status = 'PAID'
       where id = p_booking_id returning * into v_booking;
    else
      -- Money arrived for a booking that is already gone (hold expired, rejected,
      -- cancelled). Never revive it — the seat may be resold. Record the payment
      -- and queue a refund of the money actually received.
      update bookings set is_paid = true, paid_at = now(), payment_status = 'PAID'
       where id = p_booking_id returning * into v_booking;
      update payments set refund_status = 'REQUESTED', updated_at = now()
       where booking_id = p_booking_id and status = 'PAID'
         and refund_status in ('NONE', 'DECLINED');
    end if;
  else
    update payments set status = 'FAILED', verified_at = now(), verified_by = v_uid,
           verify_note = v_note, updated_at = now(),
           -- The money never arrived → nothing to refund.
           refund_status = case when refund_status = 'REQUESTED' then 'NONE' else refund_status end
     where booking_id = p_booking_id and status = 'CREATED';

    if v_booking.status = 'PENDING' and v_booking.cancel_requested_at is not null then
      -- Rider/agency already asked to cancel while this was verifying: the UTR was
      -- bogus, so finalize the cancellation now (frees the seat) with no refund.
      update bookings
         set status = case when v_booking.cancel_cause = 'AGENCY'
                           then 'REJECTED'::booking_status else 'CANCELLED'::booking_status end,
             payment_status = 'REJECTED'
       where id = p_booking_id returning * into v_booking;
    elsif v_booking.status = 'PENDING' then
      update bookings
         set payment_status = 'REJECTED', expires_at = now() + interval '10 minutes'
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
    else
      update bookings set payment_status = 'REJECTED'
       where id = p_booking_id returning * into v_booking;
    end if;
  end if;

  return v_booking;
end; $$;

-- ===========================================================================
-- #6 — agency reject / remove: a SUBMITTED payment is money-at-risk too.
-- ===========================================================================
create or replace function public.agency_remove_student_booking(p_booking_id uuid)
returns bookings language plpgsql security definer set search_path = public as $$
declare v_booking bookings; v_paid boolean;
begin
  if not public.agency_owns_booking(p_booking_id) then
    raise exception 'Not your booking' using errcode='P0003'; end if;
  select * into v_booking from bookings where id = p_booking_id for update;
  if v_booking.id is null then
    raise exception 'Booking not found' using errcode='P0002'; end if;
  if v_booking.status in ('CANCELLED','REJECTED') then return v_booking; end if;

  -- Verified payment, or UPI money sent + UTR submitted and awaiting verification.
  select v_booking.payment_status = 'SUBMITTED'
      or exists(select 1 from payments where booking_id = p_booking_id and status = 'PAID')
    into v_paid;

  if v_paid then
    -- Never silently forfeit: hold the seat + file a refund request. An
    -- unverified (CREATED) payment is only paid out after the admin verifies it.
    if v_booking.cancel_requested_at is not null then return v_booking; end if;
    update bookings
       set cancel_requested_at = now(), cancel_cause = 'AGENCY'
     where id = p_booking_id
     returning * into v_booking;
    update payments set refund_status = 'REQUESTED', updated_at = now()
     where booking_id = p_booking_id and status in ('PAID', 'CREATED')
       and refund_status in ('NONE', 'DECLINED');
    return v_booking; -- seat held pending refund
  else
    update bookings set status = 'REJECTED', cancel_cause = 'AGENCY'
     where id = p_booking_id and status in ('PENDING','CONFIRMED','WAITLISTED')
     returning * into v_booking;
    return v_booking; -- trigger frees the seat (REJECTED is not active)
  end if;
end; $$;
grant execute on function public.agency_remove_student_booking(uuid) to authenticated;

-- reject_booking keeps its "no longer active" error for a stale list, then
-- shares the money-safe path above.
create or replace function public.reject_booking(p_booking_id uuid)
returns bookings language plpgsql security definer set search_path = public as $$
declare v bookings;
begin
  if not public.agency_owns_booking(p_booking_id) then
    raise exception 'Not your booking' using errcode='P0003'; end if;
  select * into v from bookings where id = p_booking_id;
  if v.id is null or v.status not in ('PENDING','CONFIRMED') then
    raise exception 'This booking is no longer active (the student may have just cancelled it) — refresh the list.' using errcode='P0005'; end if;
  return public.agency_remove_student_booking(p_booking_id);
end; $$;
grant execute on function public.reject_booking(uuid) to authenticated;

-- ===========================================================================
-- #7 — process_refund: only pay out money that was verified as received.
-- Body otherwise from 0115 (keeps the cancel cause; leaves REJECTED as-is).
-- ===========================================================================
create or replace function public.process_refund(
  p_booking_id uuid, p_amount_cents bigint, p_approve boolean, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text; v_booking bookings; v_route text;
  v_amt bigint; v_kind text; v_title text; v_body text; v_note text; v_rec record;
  v_paid_cents bigint;
begin
  select role::text into v_role from profiles where id = v_uid;
  if v_role is distinct from 'SUPER_ADMIN' then
    raise exception 'Only an admin can process refunds' using errcode='P0003'; end if;

  select * into v_booking from bookings where id = p_booking_id for update;
  if v_booking.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if not exists (select 1 from payments
                  where booking_id = p_booking_id and refund_status = 'REQUESTED') then
    raise exception 'No pending refund for this booking' using errcode='P0005'; end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  select coalesce(r.name, 'your route') into v_route from routes r where r.id = v_booking.route_id;

  if p_approve then
    select amount_cents into v_paid_cents from payments
     where booking_id = p_booking_id and refund_status = 'REQUESTED' and status = 'PAID'
     limit 1;
    if v_paid_cents is null then
      raise exception 'This payment has not been verified yet — verify the UTR under "To verify" before refunding'
        using errcode = 'P0006';
    end if;
    v_amt := least(greatest(coalesce(p_amount_cents, 0), 0), v_paid_cents);
    update payments set status = 'REFUNDED', refund_status = 'PROCESSED', refund_amount_cents = v_amt,
        refunded_at = now(), refunded_by = v_uid, refund_note = v_note, updated_at = now()
     where booking_id = p_booking_id and status = 'PAID';
    -- NOW finalize the cancellation → frees the seat + promotes the waitlist (trigger).
    update bookings set status = 'CANCELLED', cancel_cause = coalesce(cancel_cause, 'STUDENT')
     where id = p_booking_id and status not in ('CANCELLED', 'REJECTED');
    v_kind := 'REFUNDED'; v_title := 'Refund processed — booking cancelled';
    v_body := 'A refund of ₹' || (v_amt / 100)::text || ' for ' || v_route ||
              ' has been sent, and your booking is now cancelled.';
  else
    -- DECLINE → keep the booking as it is; clear the pending-cancellation flag.
    update payments set refund_status = 'DECLINED',
        refunded_at = now(), refunded_by = v_uid, refund_note = v_note, updated_at = now()
     where booking_id = p_booking_id and refund_status = 'REQUESTED';
    update bookings set cancel_requested_at = null, cancel_cause = null, refund_details = null
     where id = p_booking_id and status in ('PENDING', 'CONFIRMED');
    v_kind := 'CANCELLED'; v_title := 'Refund request declined';
    v_body := 'Your refund request for ' || v_route || ' was declined' ||
              case when v_booking.status in ('PENDING', 'CONFIRMED')
                   then ', so your booking is still active.' else '.' end ||
              coalesce(' Note: ' || v_note, '');
  end if;

  -- Notify the rider + linked parents (bell + email + push), best-effort.
  begin
    for v_rec in
      select s.profile_id as pid, pr.email as email
      from students s left join profiles pr on pr.id = s.profile_id
      where s.id = v_booking.student_id and s.profile_id is not null
      union
      select pa.profile_id, pr.email
      from parent_students ps
      join parents pa on pa.id = ps.parent_id
      left join profiles pr on pr.id = pa.profile_id
      where ps.student_id = v_booking.student_id and pa.profile_id is not null
    loop
      insert into notifications (institution_id, recipient_id, title, body)
      values (v_booking.institution_id, v_rec.pid, v_title, v_body);
      if v_rec.email is not null then
        insert into email_outbox (recipient_id, to_email, kind, title, body, booking_id)
        values (v_rec.pid, v_rec.email, v_kind, v_title, v_body, p_booking_id);
      end if;
      insert into push_outbox (recipient_id, kind, title, body, url, booking_id)
      values (v_rec.pid, v_kind, v_title, v_body, '/student/history', p_booking_id);
    end loop;
  exception when others then
    raise warning 'process_refund notify failed for booking %: %', p_booking_id, sqlerrm;
  end;
end; $$;
grant execute on function public.process_refund(uuid, bigint, boolean, text) to authenticated;

-- ===========================================================================
-- #8 — bus_live_location: also answer SUPER_ADMIN, the route's agency owner and
-- the route's campus admin; riders/parents need an ACTIVE booking.
-- ===========================================================================
create or replace function public.bus_live_location(p_route_id uuid)
returns table (live boolean, lat double precision, lng double precision, updated_at timestamptz, bus_number text)
language sql stable security definer set search_path = public as $$
  select (coalesce(dl.is_online, false) and dl.updated_at > now() - interval '2 minutes') as live,
         case when coalesce(dl.is_online, false) and dl.updated_at > now() - interval '2 minutes'
              then dl.lat end,
         case when coalesce(dl.is_online, false) and dl.updated_at > now() - interval '2 minutes'
              then dl.lng end,
         dl.updated_at, v.bus_number
  from routes r
  join vehicles v on v.id = r.vehicle_id
  -- Only the DRIVER substitute matters for the live map (see 0056).
  left join bus_driver_changes dc
    on dc.vehicle_id = v.id and dc.role = 'DRIVER'
   and dc.effective_date = (now() at time zone 'Asia/Kolkata')::date
  left join driver_locations dl on dl.driver_id = coalesce(dc.driver_id, v.driver_id)
  where r.id = p_route_id
    and (
      public.jwt_role() = 'SUPER_ADMIN'
      or exists (select 1 from agencies a
                  where a.id = r.agency_id and a.owner_profile_id = auth.uid())
      or (public.jwt_role() = 'INSTITUTION_ADMIN'
          and r.institution_id is not null
          and r.institution_id = public.jwt_institution())
      or exists (
        select 1 from bookings b join students s on s.id = b.student_id
        where b.route_id = p_route_id and s.profile_id = auth.uid()
          and b.status in ('PENDING','CONFIRMED')
      )
      or exists (
        select 1 from bookings b
        join parent_students ps on ps.student_id = b.student_id
        join parents pa on pa.id = ps.parent_id
        where b.route_id = p_route_id and pa.profile_id = auth.uid()
          and b.status in ('PENDING','CONFIRMED')
      )
    )
  limit 1;
$$;
grant execute on function public.bus_live_location(uuid) to authenticated;

-- ===========================================================================
-- #9 — stale "online" flag.
-- ===========================================================================
-- The driver panel resumes tracking only if the last ping is recent (a page
-- refresh), not after the app was killed hours ago.
create or replace function public.driver_status()
returns table (is_online boolean, lat double precision, lng double precision, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select coalesce(dl.is_online, false) and dl.updated_at > now() - interval '5 minutes',
         dl.lat, dl.lng, dl.updated_at
  from drivers d
  left join driver_locations dl on dl.driver_id = d.id
  where d.profile_id = auth.uid()
  limit 1;
$$;

-- Clear flags whose driver stopped pinging (app killed / phone off), so the
-- admin + campus "online" lists stop counting them too. A live app keeps pinging
-- (heartbeat) and driver_update_location sets is_online back to true.
create or replace function public.clear_stale_driver_online() returns integer
language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  update driver_locations set is_online = false, lat = null, lng = null
   where is_online and updated_at < now() - interval '10 minutes';
  get diagnostics v_count = row_count;
  return v_count;
end; $$;
revoke execute on function public.clear_stale_driver_online() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'clear-stale-driver-online';
    perform cron.schedule('clear-stale-driver-online', '*/5 * * * *',
                          'select public.clear_stale_driver_online();');
  end if;
end $$;

select public.clear_stale_driver_online();

notify pgrst, 'reload schema';
