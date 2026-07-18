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
 * Count events for (scope, subject) inside the last `windowSeconds`. If already
 * at/over `max`, returns the seconds to wait; otherwise records one event and
 * returns 0 (allowed). Stale rows for the key are pruned on the way in.
 */
export async function rateLimit(
  scope: string,
  subject: string,
  max: number,
  windowSeconds: number,
): Promise<number> {
  try {
    const admin = createAdminClient();
    const key = subject.trim().toLowerCase();
    const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
    // Prune anything older than the window for this key (keeps the table small).
    await admin.from(TABLE).delete().eq('scope', scope).eq('subject', key).lt('created_at', since);
    const { data, error } = await admin
      .from(TABLE)
      .select('created_at')
      .eq('scope', scope)
      .eq('subject', key)
      .order('created_at', { ascending: true });
    if (error) return 0; // fail open
    if ((data?.length ?? 0) >= max) {
      const oldest = new Date(data![0]!.created_at as string).getTime();
      return Math.max(1, Math.ceil((oldest + windowSeconds * 1000 - Date.now()) / 1000));
    }
    await admin.from(TABLE).insert({ scope, subject: key });
    return 0;
  } catch {
    return 0; // fail open
  }
}

// ── OTP brute-force lockout ──────────────────────────────────────────────────
// Wrong-code guesses are counted per email (NOT per token, so requesting fresh
// codes can't reset the counter). After OTP_MAX_FAILURES within OTP_WINDOW the
// address is locked; a correct code clears the counter.
const OTP_MAX_FAILURES = 5;
const OTP_WINDOW_SECONDS = 15 * 60;
const OTP_SCOPE = 'otp:fail';

/** Seconds until the OTP lock lifts for this email, or 0 if not locked. */
export async function otpLockRemaining(email: string): Promise<number> {
  try {
    const admin = createAdminClient();
    const key = email.trim().toLowerCase();
    const since = new Date(Date.now() - OTP_WINDOW_SECONDS * 1000).toISOString();
    await admin.from(TABLE).delete().eq('scope', OTP_SCOPE).eq('subject', key).lt('created_at', since);
    const { data, error } = await admin
      .from(TABLE)
      .select('created_at')
      .eq('scope', OTP_SCOPE)
      .eq('subject', key)
      .order('created_at', { ascending: true });
    if (error) return 0;
    if ((data?.length ?? 0) >= OTP_MAX_FAILURES) {
      const oldest = new Date(data![0]!.created_at as string).getTime();
      return Math.max(1, Math.ceil((oldest + OTP_WINDOW_SECONDS * 1000 - Date.now()) / 1000));
    }
    return 0;
  } catch {
    return 0;
  }
}

export async function recordOtpFailure(email: string): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from(TABLE).insert({ scope: OTP_SCOPE, subject: email.trim().toLowerCase() });
  } catch {
    /* best effort */
  }
}

export async function clearOtpFailures(email: string): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from(TABLE).delete().eq('scope', OTP_SCOPE).eq('subject', email.trim().toLowerCase());
  } catch {
    /* best effort */
  }
}
