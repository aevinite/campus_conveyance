import 'server-only';
import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';

// Sliding-window rate limiting + OTP lockout, backed by the service-role-only
// `rate_limit_events` table (migration 0034). All helpers run SERVER-SIDE with
// the service-role client, which bypasses RLS.
//
// Design note — these limiters FAIL OPEN: if the backing store errors, they
// return "allowed" rather than blocking. A limiter outage must never take down
// real signups/resets — the same class of outage this is meant to prevent.

const TABLE = 'rate_limit_events';

/** Best-effort client IP from the proxy headers (for per-IP limits). */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return h.get('x-real-ip') ?? 'unknown';
}

/**
 * Atomic sliding-window limiter for (scope, subject). Returns the seconds to
 * wait if already at/over `max` in the last `windowSeconds`, else records one
 * event and returns 0 (allowed). The count + conditional insert happen in ONE
 * round-trip via the rate_limit_hit RPC (migration 0073), serialized per key by
 * an advisory lock — no count-then-insert TOCTOU.
 *
 * On a store error the default is FAIL-OPEN (return 0) so a limiter outage can't
 * take down real signups/resets. Pass `{ failClosed: true }` for callers where an
 * uncapped burst is the worse outcome (the geocoding upstream caps: a
 * rate_limit_events outage must NOT uncork Nominatim/Photon and get the IP
 * banned) — those get a positive back-off instead.
 */
export async function rateLimit(
  scope: string,
  subject: string,
  max: number,
  windowSeconds: number,
  opts?: { failClosed?: boolean },
): Promise<number> {
  const onError = () => (opts?.failClosed ? Math.max(1, windowSeconds) : 0);
  try {
    const admin = createAdminClient();
    const key = subject.trim().toLowerCase();
    const { data, error } = await admin.rpc('rate_limit_hit', {
      p_scope: scope,
      p_subject: key,
      p_max: max,
      p_window_seconds: windowSeconds,
    });
    if (error) return onError();
    return typeof data === 'number' ? data : 0;
  } catch {
    return onError();
  }
}

// ── OTP brute-force lockout ──────────────────────────────────────────────────
// Attempts are counted per email (NOT per token, so requesting fresh codes can't
// reset the counter). After OTP_MAX_FAILURES within OTP_WINDOW the address is
// locked; a correct code clears the counter. Counting is ATOMIC — it routes
// through rateLimit()/rate_limit_hit (advisory-locked count+insert), so N
// concurrent guesses can't all slip under the cap (the old SELECT-then-INSERT
// had a TOCTOU that let more than OTP_MAX_FAILURES through at once).
const OTP_MAX_FAILURES = 5;
const OTP_WINDOW_SECONDS = 15 * 60;
const OTP_SCOPE = 'otp:fail';

/**
 * Atomically reserve one OTP attempt. Returns seconds-to-wait if the address is
 * already locked (attempt NOT consumed), else 0 (attempt recorded). Call this
 * BEFORE checking the code; clear on a correct code.
 */
export async function registerOtpAttempt(email: string): Promise<number> {
  // failClosed: a limiter/store outage must LOCK (not silently disable the OTP
  // guess-lockout while auth stays up).
  return rateLimit(OTP_SCOPE, email, OTP_MAX_FAILURES, OTP_WINDOW_SECONDS, { failClosed: true });
}

export async function clearOtpFailures(email: string): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from(TABLE).delete().eq('scope', OTP_SCOPE).eq('subject', email.trim().toLowerCase());
  } catch {
    /* best effort */
  }
}

// ── Password-login brute-force lockout ───────────────────────────────────────
// App-level throttle on failed password logins for the shared login flow (all
// four login routes go through signInAndRoute). Keyed per (email|IP) so an
// attacker pounding one account from one host locks THAT combination — it can't
// be abused to lock a victim out of their own IP. A correct login clears it.
const LOGIN_MAX_FAILURES = 10;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_SCOPE = 'login:fail';

/**
 * Atomically reserve one login attempt (per email|IP). Returns seconds-to-wait
 * if already locked (not consumed), else 0 (recorded). Atomic via rate_limit_hit
 * — no SELECT-then-INSERT TOCTOU. Clear on a successful login.
 */
export async function registerLoginAttempt(subject: string): Promise<number> {
  // failClosed: a store outage should lock, not unlock, the brute-force guard.
  return rateLimit(LOGIN_SCOPE, subject, LOGIN_MAX_FAILURES, LOGIN_WINDOW_SECONDS, { failClosed: true });
}

export async function clearLoginFailures(subject: string): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from(TABLE).delete().eq('scope', LOGIN_SCOPE).eq('subject', subject.trim().toLowerCase());
  } catch {
    /* best effort */
  }
}
