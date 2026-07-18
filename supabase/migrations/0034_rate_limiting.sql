-- 0034_rate_limiting.sql (idempotent)
-- Server-side state for rate limiting + OTP brute-force lockout.
--
-- The email flows (signup / password reset / agency email-OTP) were stateless, so
-- there was nothing to (a) cap how many mails an address/IP could trigger — an
-- email-bomb + Gmail-quota-exhaustion vector — or (b) count wrong OTP guesses, so
-- a 6-digit code (1,000,000 combinations) could be brute-forced with no lockout.
--
-- This table is a simple sliding-window event log keyed by (scope, subject):
--   scope   = what is being limited, e.g. 'email:otp' / 'email:signup' /
--             'email:reset' / 'email:ip' / 'otp:fail'
--   subject = the normalized email or client IP the limit applies to
-- The application (server-only, service-role) inserts one row per event and
-- counts rows inside the window. See src/lib/rate-limit.ts.

create table if not exists public.rate_limit_events (
  id         bigint generated always as identity primary key,
  scope      text        not null,
  subject    text        not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_rate_limit_events_lookup
  on public.rate_limit_events (scope, subject, created_at);

-- Locked down to the service role only. RLS is on with NO policy, so the
-- authenticated/anon PostgREST roles are denied every row; the server actions
-- reach it exclusively through the service-role client (which bypasses RLS).
-- The explicit REVOKE is belt-and-suspenders in case default grants are broad.
alter table public.rate_limit_events enable row level security;
revoke all on public.rate_limit_events from anon, authenticated;
