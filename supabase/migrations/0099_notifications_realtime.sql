-- 0099_notifications_realtime.sql (idempotent — requires 0001/0002)
--
-- Realtime notification bell. The bell previously only refreshed on navigation.
-- To let the browser subscribe via Supabase Realtime, the `notifications` table
-- needs (a) a SELECT RLS policy for the recipient's OWN rows (Realtime enforces
-- RLS to authorize a subscription), and (b) membership in the `supabase_realtime`
-- publication.
--
-- The SELECT policy is purely additive — the existing RPC-only read/write path
-- (my_notifications / mark_notification_read, all security-definer) is unchanged;
-- this just also lets a signed-in user read (and subscribe to) their own rows.

-- (1) Own-row read policy.
drop policy if exists notifications_own_read on public.notifications;
create policy notifications_own_read on public.notifications
  for select to authenticated
  using (recipient_id = auth.uid());

-- (2) Add the table to the realtime publication (create the publication if the
--     project somehow lacks it). Guarded so re-runs are a no-op.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
