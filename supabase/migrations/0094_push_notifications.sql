-- 0094_push_notifications.sql (idempotent — requires 0001, 0050, 0093)
--
-- Web-Push browser notifications for the booking lifecycle, PLUS a reliability
-- fix for the booking-CONFIRMED email.
--
-- (A) PUSH  — a new `push_subscriptions` table stores each account's browser
--     PushManager subscription. The `booking_notify` trigger (from 0093) is
--     extended to also enqueue a `push_outbox` row per recipient, drained by a
--     best-effort Node sender (src/lib/push.ts) over the VAPID web-push
--     transport. Mirrors the email_outbox design exactly: RLS-locked outbox,
--     atomic claim RPC, retention pruning.
--
-- (B) CONFIRMED-EMAIL RELIABILITY — until now the student's booking-confirmed
--     email was a ONE-SHOT `after()` send from payBookingAction with no retry,
--     and the trigger deliberately skipped the student's outbox row to avoid a
--     duplicate. A single transient SMTP hiccup therefore lost the confirmation
--     mail entirely. This migration removes that skip so the student's CONFIRMED
--     email now flows through the retry-backed outbox like every other lifecycle
--     mail (the drainer renders the RICH template for CONFIRMED rows). The
--     one-shot send is removed in the app layer.
--
-- The whole trigger body stays wrapped in an exception guard: a notification
-- failure is logged (RAISE WARNING) and swallowed — it can NEVER roll back or
-- block a real booking transaction.

-- ---------------------------------------------------------------------------
-- (1) Push subscriptions. One row per browser endpoint. Owned by the account;
--     the service-role sender bypasses RLS to read them for delivery.
-- ---------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists idx_push_subscriptions_profile
  on public.push_subscriptions (profile_id);

alter table public.push_subscriptions enable row level security;

-- Owners manage only their own subscriptions. (Service role bypasses RLS.)
drop policy if exists push_sub_select_own on public.push_subscriptions;
create policy push_sub_select_own on public.push_subscriptions
  for select using (profile_id = auth.uid());
drop policy if exists push_sub_insert_own on public.push_subscriptions;
create policy push_sub_insert_own on public.push_subscriptions
  for insert with check (profile_id = auth.uid());
drop policy if exists push_sub_update_own on public.push_subscriptions;
create policy push_sub_update_own on public.push_subscriptions
  for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());
drop policy if exists push_sub_delete_own on public.push_subscriptions;
create policy push_sub_delete_own on public.push_subscriptions
  for delete using (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- (2) Push outbox. Locked down by RLS with no policy → only the service-role
--     sender (which bypasses RLS) reads/writes it. Mirrors email_outbox.
-- ---------------------------------------------------------------------------
create table if not exists public.push_outbox (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid references public.profiles(id) on delete set null,
  kind         text not null,            -- RESERVED | WAITLISTED | CONFIRMED | REJECTED | PROMOTED | EXPIRED | CANCELLED
  title        text not null,
  body         text not null,
  url          text,                     -- deep-link opened on notification click
  booking_id   uuid references public.bookings(id) on delete set null,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  attempts     int not null default 0,
  last_error   text
);
create index if not exists idx_push_outbox_unsent
  on public.push_outbox (created_at) where sent_at is null;

alter table public.push_outbox enable row level security;
-- No policies on purpose: authenticated/anon fully denied; service role bypasses.

-- ---------------------------------------------------------------------------
-- (3) Lifecycle trigger, redefined. Same logic as 0093 with two changes:
--       • CONFIRMED no longer skips the student's email (reliability fix).
--       • Each recipient also gets a push_outbox row.
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
  v_url         text;              -- deep link for the push notification
  v_student_pid uuid;              -- the student's own profile id (for skip logic)
  v_skip_student boolean := false; -- skip student entirely (self-initiated)
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

    -- Deep link: confirmed/reserved land on My Bookings; everything else too.
    v_url := '/student/bookings';

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

      -- (a) in-app bell
      insert into notifications (institution_id, recipient_id, title, body)
      values (new.institution_id, v_rec.pid, v_title, v_body);

      -- (b) email (retry-backed outbox — now includes the student's CONFIRMED
      --     mail; the drainer renders the rich template for CONFIRMED rows).
      if v_rec.email is not null then
        insert into email_outbox (recipient_id, to_email, kind, title, body, booking_id)
        values (v_rec.pid, v_rec.email, v_kind, v_title, v_body, new.id);
      end if;

      -- (c) web push (best-effort; only delivered if the account has subscribed)
      insert into push_outbox (recipient_id, kind, title, body, url, booking_id)
      values (v_rec.pid, v_kind, v_title, v_body, v_url, new.id);
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
-- (4) Atomic claim for the Node push sender. FOR UPDATE SKIP LOCKED +
--     attempts++ so concurrent drains can't grab the same row. Service-role only.
-- ---------------------------------------------------------------------------
create or replace function public.claim_push_outbox(p_limit int default 20)
returns setof public.push_outbox
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.push_outbox o
     set attempts = o.attempts + 1
   where o.id in (
     select e.id from public.push_outbox e
      where e.sent_at is null and e.attempts < 5
      order by e.created_at
      for update skip locked
      limit greatest(1, least(coalesce(p_limit, 20), 100))
   )
  returning o.*;
end; $$;
revoke all on function public.claim_push_outbox(int) from public;
grant execute on function public.claim_push_outbox(int) to service_role;

-- ---------------------------------------------------------------------------
-- (5) Retention. Fold push_outbox + dead-subscription pruning into the daily
--     sweep (recreating retention_cleanup is idempotent; the 0061 cron keeps
--     calling it). Keeps the 0093 email_outbox + other retention intact.
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
  delete from push_outbox
    where (sent_at is not null and sent_at < now() - interval '30 days')
       or (sent_at is null and attempts >= 5 and created_at < now() - interval '7 days');
  -- Push endpoints go stale (browser cleared, uninstalled); prune ones unseen
  -- for 90 days. Live ones are refreshed by the client on every dashboard load.
  delete from push_subscriptions where last_seen_at < now() - interval '90 days';
$$;
