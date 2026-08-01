-- 0112_cancellation_refunds.sql (idempotent — requires 0093/0094/0103/0107)
--
-- REFUNDS for cancelled PAID bookings (user decision 2026-08-01: admin decides
-- each refund amount case-by-case, processed manually in /aevinite → Payments).
--
-- Cancellation already works (cancel_booking frees the seat + records the rider's
-- payout details on bookings.refund_details), but the refund was a dead end: the
-- payout was never surfaced, no money moved, the payment stayed PAID. This adds:
--   * refund tracking columns on `payments`,
--   * cancel_booking now flags a PAID booking's payment refund_status='REQUESTED',
--   * process_refund() — SUPER_ADMIN records the refund amount (or declines) and
--     notifies the rider + linked parents (bell + email + push).

-- ---------------------------------------------------------------------------
-- (1) Refund tracking on payments (the payout details live on bookings.refund_details).
-- ---------------------------------------------------------------------------
alter table payments add column if not exists refund_status text not null default 'NONE';
do $$ begin
  alter table payments add constraint payments_refund_status_chk
    check (refund_status in ('NONE','REQUESTED','PROCESSED','DECLINED'));
exception when duplicate_object then null; end $$;
alter table payments add column if not exists refund_amount_cents bigint;
alter table payments add column if not exists refunded_at  timestamptz;
alter table payments add column if not exists refunded_by  uuid references profiles(id) on delete set null;
alter table payments add column if not exists refund_note  text;

create index if not exists idx_payments_refund_requested
  on payments (created_at) where refund_status = 'REQUESTED';

-- ---------------------------------------------------------------------------
-- (2) cancel_booking — 0103 body + flag a PAID booking's payment for refund.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_booking(
  p_booking_id uuid, p_reason text default null, p_refund jsonb default null
) returns bookings language plpgsql security definer set search_path = public as $$
declare v_booking bookings;
begin
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if not public.can_act_for_student(v_booking.student_id) then
    raise exception 'Not your booking' using errcode='P0003'; end if;
  if v_booking.status in ('CANCELLED','REJECTED') then return v_booking; end if;
  update bookings
     set status='CANCELLED',
         cancel_cause='STUDENT',
         cancel_reason  = nullif(btrim(coalesce(p_reason, '')), ''),
         refund_details = p_refund
   where id = p_booking_id
   returning * into v_booking;

  -- If the seat was actually paid for (a verified UPI payment), open a refund
  -- request for the admin to process.
  update payments set refund_status='REQUESTED', updated_at=now()
   where booking_id = p_booking_id and status='PAID' and refund_status='NONE';

  return v_booking; -- trigger updates reserved_seats + promotes the waitlist
end; $$;
grant execute on function public.cancel_booking(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- (3) process_refund — SUPER_ADMIN records the refund (or declines) + notifies.
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
    update payments set status='REFUNDED', refund_status='PROCESSED', refund_amount_cents=v_amt,
        refunded_at=now(), refunded_by=v_uid, refund_note=v_note, updated_at=now()
     where booking_id = p_booking_id;
    v_kind := 'REFUNDED'; v_title := 'Refund processed';
    v_body := 'A refund of ₹' || (v_amt / 100)::text || ' for ' || v_route ||
              ' has been sent to the payout details you gave when cancelling.';
  else
    update payments set refund_status='DECLINED',
        refunded_at=now(), refunded_by=v_uid, refund_note=v_note, updated_at=now()
     where booking_id = p_booking_id;
    v_kind := 'CANCELLED'; v_title := 'Cancellation processed';
    v_body := 'Your cancellation for ' || v_route || ' has been processed.' ||
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
