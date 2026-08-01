-- 0115_refund_hold_cancellation.sql (idempotent — requires 0112_cancellation_refunds)
--
-- Change the PAID-booking cancellation flow: the seat is no longer freed the
-- instant the rider asks to cancel. Instead the booking is HELD as
-- "cancellation requested — refund pending" until the admin actually processes
-- the refund. Only on APPROVE does the booking cancel + free the seat; on
-- DECLINE the booking stays active (the rider keeps their seat). Unpaid bookings
-- (pending holds / waitlist) still cancel immediately since there's nothing to
-- refund.

alter table public.bookings add column if not exists cancel_requested_at timestamptz;

-- ---------------------------------------------------------------------------
-- cancel_booking — PAID → file a hold+refund request (seat stays); else cancel.
-- ---------------------------------------------------------------------------
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

  -- Was this seat actually paid for (a verified UPI payment)?
  select exists(select 1 from payments where booking_id = p_booking_id and status = 'PAID') into v_paid;

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
    update payments set refund_status = 'REQUESTED', updated_at = now()
     where booking_id = p_booking_id and status = 'PAID' and refund_status in ('NONE', 'DECLINED');
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

-- ---------------------------------------------------------------------------
-- process_refund — APPROVE now finalizes the cancellation; DECLINE keeps the
-- booking active (rider keeps the seat).
-- ---------------------------------------------------------------------------
create or replace function public.process_refund(
  p_booking_id uuid, p_amount_cents bigint, p_approve boolean, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text; v_booking bookings; v_route text;
  v_amt bigint; v_kind text; v_title text; v_body text; v_note text; v_rec record;
begin
  select role::text into v_role from profiles where id = v_uid;
  if v_role is distinct from 'SUPER_ADMIN' then
    raise exception 'Only an admin can process refunds' using errcode='P0003'; end if;

  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if not exists (select 1 from payments
                  where booking_id = p_booking_id and refund_status = 'REQUESTED') then
    raise exception 'No pending refund for this booking' using errcode='P0005'; end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  select coalesce(r.name, 'your route') into v_route from routes r where r.id = v_booking.route_id;

  if p_approve then
    v_amt := greatest(coalesce(p_amount_cents, 0), 0);
    update payments set status = 'REFUNDED', refund_status = 'PROCESSED', refund_amount_cents = v_amt,
        refunded_at = now(), refunded_by = v_uid, refund_note = v_note, updated_at = now()
     where booking_id = p_booking_id;
    -- NOW finalize the cancellation → frees the seat + promotes the waitlist (trigger).
    update bookings set status = 'CANCELLED', cancel_cause = 'STUDENT'
     where id = p_booking_id and status <> 'CANCELLED';
    v_kind := 'REFUNDED'; v_title := 'Refund processed — booking cancelled';
    v_body := 'A refund of ₹' || (v_amt / 100)::text || ' for ' || v_route ||
              ' has been sent to the payout details you gave, and your booking is now cancelled.';
  else
    -- DECLINE → keep the booking active; clear the pending-cancellation flag.
    update payments set refund_status = 'DECLINED',
        refunded_at = now(), refunded_by = v_uid, refund_note = v_note, updated_at = now()
     where booking_id = p_booking_id;
    update bookings set cancel_requested_at = null, cancel_cause = null, refund_details = null
     where id = p_booking_id;
    v_kind := 'CANCELLED'; v_title := 'Refund request declined';
    v_body := 'Your refund request for ' || v_route || ' was declined, so your booking is still active.' ||
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
