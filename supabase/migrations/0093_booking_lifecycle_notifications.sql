-- 0093_booking_lifecycle_notifications.sql (idempotent — requires 0001, 0035, 0037, 0050)
--
-- Booking-lifecycle notifications across the in-app bell AND email.
--
-- Until now the only rows written to `notifications` were driver ride-stage
-- events (0043/0056/0086). The booking lifecycle itself — reserve, pay/confirm,
-- reject, waitlist-promotion, hold-expiry — produced no alert at all, so a
-- commuter had to sit inside the app to learn whether their seat went through.
--
-- This migration adds ONE trigger on `bookings` that fires on every state
-- change from ANY path (student/agency server actions, the waitlist-promotion
-- trigger, and the payment-timeout pg_cron sweep). For each event it:
--   (a) writes an in-app notification to the student + every linked parent, and
--   (b) enqueues an email row per recipient into a new `email_outbox` table,
--       which a best-effort Node drainer (src/lib/email-outbox.ts) sends via the
--       existing Gmail/Nodemailer transport.
--
-- The whole trigger body is wrapped in an exception guard: a notification/email
-- failure is logged (RAISE WARNING) and swallowed, so it can NEVER roll back or
-- block a real booking transaction.

-- ---------------------------------------------------------------------------
-- (1) Email outbox. Locked down by RLS with no policy → only the service-role
--     drainer (which bypasses RLS) can read/write it. Rows are drained, marked
--     sent, and pruned by retention.
-- ---------------------------------------------------------------------------
create table if not exists public.email_outbox (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid references public.profiles(id) on delete set null,
  to_email     text not null,
  kind         text not null,            -- RESERVED | WAITLISTED | CONFIRMED | REJECTED | PROMOTED | EXPIRED | CANCELLED
  title        text not null,            -- reused as the email subject + heading
  body         text not null,            -- one-sentence body
  booking_id   uuid references public.bookings(id) on delete set null,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  attempts     int not null default 0,
  last_error   text
);
create index if not exists idx_email_outbox_unsent
  on public.email_outbox (created_at) where sent_at is null;

alter table public.email_outbox enable row level security;
-- No policies on purpose: authenticated/anon are fully denied; the service-role
-- key bypasses RLS for the drainer.

-- ---------------------------------------------------------------------------
-- (2) The lifecycle trigger. AFTER INSERT OR UPDATE; acts on INSERT (new hold)
--     and on any status change. Fully exception-guarded.
-- ---------------------------------------------------------------------------
create or replace function public.booking_notify()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_route       text;
  v_who         text;              -- "Your child" phrasing for parents
  v_title       text;
  v_body        text;
  v_kind        text;
  v_student_pid uuid;              -- the student's own profile id (for skip logic)
  v_skip_student      boolean := false;  -- skip student entirely (self-initiated)
  v_skip_student_mail boolean := false;  -- skip ONLY the student's email (rich mail sent elsewhere)
  v_rec         record;
begin
  begin
    -- Decide which lifecycle event this is; bail out (no-op) for updates that
    -- don't change status.
    if tg_op = 'INSERT' then
      if new.status = 'PENDING' then
        v_kind := 'RESERVED';
      elsif new.status = 'WAITLISTED' then
        v_kind := 'WAITLISTED';
      else
        return new;  -- other insert states carry no user-facing meaning
      end if;
    elsif tg_op = 'UPDATE' then
      if new.status is not distinct from old.status then
        return new;  -- status unchanged → not a lifecycle event
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
        else
          v_kind := 'CANCELLED';
        end if;
      else
        return new;  -- any other transition is not user-facing
      end if;
    else
      return new;
    end if;

    select r.name into v_route from routes r where r.id = new.route_id;
    v_route := coalesce(v_route, 'your route');
    v_who := coalesce(nullif(btrim(new.student_name), ''), 'Your child');
    select s.profile_id into v_student_pid from students s where s.id = new.student_id;

    -- Compose the human title + body per event.
    if v_kind = 'RESERVED' then
      v_title := 'Seat reserved — finish payment';
      v_body  := 'Your seat on ' || v_route || ' is held. Complete payment within 20 minutes to confirm it.';
    elsif v_kind = 'WAITLISTED' then
      v_title := 'You''re on the waitlist';
      v_body  := v_route || ' is full right now — you''re on the waitlist and we''ll let you know the moment a seat opens up.';
    elsif v_kind = 'CONFIRMED' then
      v_title := 'Booking confirmed';
      v_body  := 'Your seat on ' || v_route || ' is confirmed. Have a safe ride!';
      -- The student receives the richer confirmed email from the payment action;
      -- only email the parents here (student still gets the in-app bell alert).
      v_skip_student_mail := true;
    elsif v_kind = 'REJECTED' then
      v_title := 'Booking rejected';
      v_body  := 'Your booking for ' || v_route || ' was rejected by the agency. Any payment hold has been released — you can book another route anytime.';
    elsif v_kind = 'PROMOTED' then
      v_title := 'A seat opened up!';
      v_body  := 'Good news — a seat opened on ' || v_route || '. Complete payment within 20 minutes to confirm it before it''s offered to the next person.';
    elsif v_kind = 'EXPIRED' then
      v_title := 'Reservation expired';
      v_body  := 'Your seat hold on ' || v_route || ' expired because payment wasn''t completed in time. The seat has been released — you can book again anytime.';
    elsif v_kind = 'CANCELLED_SELF' then
      -- Student cancelled themselves: skip the student, tell the parents only.
      v_kind  := 'CANCELLED';
      v_skip_student := true;
      v_title := 'Booking cancelled';
      v_body  := v_who || ' cancelled their booking for ' || v_route || '.';
    else -- CANCELLED (other causes, e.g. removed by agency)
      v_title := 'Booking cancelled';
      v_body  := 'Your booking for ' || v_route || ' was cancelled and the seat released.';
    end if;

    -- Fan out to the student's own account + every linked parent account.
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
      -- Self-initiated cancel: don't notify the student about their own action.
      if v_skip_student and v_rec.pid = v_student_pid then
        continue;
      end if;

      insert into notifications (institution_id, recipient_id, title, body)
      values (new.institution_id, v_rec.pid, v_title, v_body);

      if v_rec.email is not null
         and not (v_skip_student_mail and v_rec.pid = v_student_pid) then
        insert into email_outbox (recipient_id, to_email, kind, title, body, booking_id)
        values (v_rec.pid, v_rec.email, v_kind, v_title, v_body, new.id);
      end if;
    end loop;

  exception when others then
    -- Notifications are strictly best-effort: never let one break a booking.
    raise warning 'booking_notify failed for booking %: %', new.id, sqlerrm;
  end;

  return new;
end; $$;

drop trigger if exists trg_booking_notify on public.bookings;
create trigger trg_booking_notify
  after insert or update on public.bookings
  for each row execute function public.booking_notify();

-- ---------------------------------------------------------------------------
-- (3) Atomic claim for the Node drainer. FOR UPDATE SKIP LOCKED + attempts++ so
--     two concurrent drains can't grab the same row (no double-send). Only the
--     service role may run it.
-- ---------------------------------------------------------------------------
create or replace function public.claim_email_outbox(p_limit int default 20)
returns setof public.email_outbox
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.email_outbox o
     set attempts = o.attempts + 1
   where o.id in (
     select e.id from public.email_outbox e
      where e.sent_at is null and e.attempts < 5
      order by e.created_at
      for update skip locked
      limit greatest(1, least(coalesce(p_limit, 20), 100))
   )
  returning o.*;
end; $$;
revoke all on function public.claim_email_outbox(int) from public;
grant execute on function public.claim_email_outbox(int) to service_role;

-- ---------------------------------------------------------------------------
-- (4) Retention. Fold email_outbox pruning into the existing daily sweep
--     (0061) so the cron entry stays a single call. Recreating the function is
--     idempotent; the cron schedule from 0061 keeps calling it.
-- ---------------------------------------------------------------------------
create or replace function public.retention_cleanup() returns void
language sql security definer set search_path = public as $$
  delete from ride_events where created_at < now() - interval '90 days';
  delete from notifications
    where created_at < now() - interval '90 days'
       or (is_read = true and created_at < now() - interval '30 days');
  delete from parent_link_codes where expires_at < now() - interval '1 day';
  -- Sent mail after 30 days; give-up (attempts exhausted) rows after 7.
  delete from email_outbox
    where (sent_at is not null and sent_at < now() - interval '30 days')
       or (sent_at is null and attempts >= 5 and created_at < now() - interval '7 days');
$$;
