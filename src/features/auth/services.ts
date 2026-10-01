import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LoginInput } from './schemas';
import { getSessionClaims } from './session';
import { isAccountDeactivated } from './account-status';
import { dashboardFor } from '@/lib/rbac/roles';
import { AuthError, toErrorResponse } from '@/lib/errors/app-error';
import {
  getClientIp,
  registerLoginAttempt,
  clearLoginFailures,
  registerLoginAttemptForEmail,
  clearLoginFailuresForEmail,
} from '@/lib/rate-limit';

export async function loginUser(db: SupabaseClient, input: LoginInput) {
  const { error } = await db.auth.signInWithPassword(input);
  if (error) throw new AuthError(error.message);
}

/**
 * The full password-login sequence shared by every login screen (student,
 * agency, …): authenticate → reject soft-deleted ("removed") accounts →
 * revalidate → redirect to the dashboard matching the account's REAL role (so
 * credentials entered on any login page land on the correct panel).
 *
 * Returns an error MESSAGE on failure; on success it redirect()s and therefore
 * never returns. Centralised so login hardening (lockouts, rate limits) lands in
 * ONE place instead of being copy-pasted per login action and drifting.
 */
export async function signInAndRoute(db: SupabaseClient, input: LoginInput): Promise<string> {
  // App-level brute-force throttle (per email|IP) on top of Supabase's own
  // limits. Atomically reserve the attempt up front (no TOCTOU); a successful
  // login clears the counter below.
  const emailKey = input.email.trim().toLowerCase();
  const subject = `${emailKey}|${await getClientIp()}`;
  if ((await registerLoginAttempt(subject)) > 0) {
    return 'Too many failed attempts. Please wait a few minutes and try again.';
  }
  // Second, IP-independent cap per account so rotating IPs can't dodge the
  // lockout (audit #27).
  if ((await registerLoginAttemptForEmail(emailKey)) > 0) {
    return 'Too many failed attempts. Please wait a few minutes and try again.';
  }
  try {
    await loginUser(db, input);
  } catch (e) {
    return toErrorResponse(e).message; // attempt already counted atomically
  }
  // Resetting the failed-attempt counter is bookkeeping, not a gate — run it
  // AFTER the response is sent so it doesn't add a Supabase round-trip to the
  // time the user waits before the redirect. (after() still runs on redirect.)
  after(async () => {
    await clearLoginFailures(subject);
    await clearLoginFailuresForEmail(emailKey);
  });
  const { userId, role } = await getSessionClaims(db);
  if (userId && (await isAccountDeactivated(db, userId, role))) {
    await db.auth.signOut();
    return 'This account has been deactivated. Please contact support.';
  }
  revalidatePath('/', 'layout');
  redirect(dashboardFor(role));
}

/**
 * READ-ONLY check: is this email held by a LIVE (confirmed, not soft-deleted)
 * account? Unlike ensureEmailFreeForSignup this NEVER deletes anything. Use it
 * BEFORE a real signup is committed — e.g. the OTP "send code" step — so merely
 * asking for a verification code can't purge a pre-existing account. The actual
 * cleanup of an unconfirmed/soft-deleted leftover stays in
 * ensureEmailFreeForSignup, called only at the genuine registration moment.
 * `admin` must be a service-role client.
 */
export async function isEmailTakenByActiveAccount(
  admin: SupabaseClient,
  email: string,
): Promise<boolean> {
  const clean = email.trim();
  // Look the email up DIRECTLY on profiles via the indexed generated lower(email)
  // column (migration 0060) instead of enumerating auth users —
  // listUsers({perPage:1000}) only reads page 1, so past 1000 users this check
  // went blind and let duplicate signups through. Equality on email_lower is an
  // index probe, not the old case-insensitive ilike seq scan.
  const { data: profile } = await admin
    .from('profiles')
    .select('id, is_deleted')
    .eq('email_lower', clean.toLowerCase())
    .limit(1)
    .maybeSingle();
  if (!profile) return false; // no account holds this email
  if ((profile as { is_deleted?: boolean }).is_deleted === true) return false; // soft-deleted → not live
  // Confirmed? profiles.id === auth.users.id (FK, on delete cascade).
  const { data: userRes } = await admin.auth.admin.getUserById((profile as { id: string }).id);
  if (!userRes?.user?.email_confirmed_at) return false; // never-confirmed leftover → not live
  return true; // confirmed and not deleted → genuinely taken
}

/**
 * For an account created ON SOMEONE ELSE'S BEHALF (an agency adding a driver, an
 * admin adding a campus admin): the email must not belong to ANY account — live,
 * unconfirmed or soft-deleted. Unlike ensureEmailFreeForSignup this never
 * deletes: only the email's owner may reclaim their own leftover account (by
 * signing up themselves). Read-only. `admin` must be a service-role client.
 */
export async function emailHasNoAccount(
  admin: SupabaseClient,
  email: string,
): Promise<{ error?: string }> {
  const { data: profile, error } = await admin
    .from('profiles')
    .select('id')
    .eq('email_lower', email.trim().toLowerCase())
    .limit(1)
    .maybeSingle();
  if (error) return { error: 'Could not check that email. Please try again.' };
  if (profile) return { error: 'This email already has an account — use a different email.' };
  return {};
}

/** How old an UNCONFIRMED signup must be before a new registration may replace it. */
const STALE_UNCONFIRMED_MS = 24 * 60 * 60 * 1000;

/**
 * Does this auth user own anything we must never destroy (audit #26)? Bookings
 * (and therefore payments) hang off a students row; agencies own fleets/routes;
 * drivers/parents rows mean an operator or family set the account up. Any of
 * these → the account is NOT a disposable leftover. Fails SAFE (returns true) on
 * a lookup error.
 */
async function accountHasData(admin: SupabaseClient, id: string): Promise<boolean> {
  try {
    const [students, parents, drivers, agencies] = await Promise.all([
      admin.from('students').select('id').eq('profile_id', id),
      admin.from('parents').select('id', { count: 'exact', head: true }).eq('profile_id', id),
      admin.from('drivers').select('id', { count: 'exact', head: true }).eq('profile_id', id),
      admin
        .from('agencies')
        .select('id', { count: 'exact', head: true })
        .eq('owner_profile_id', id)
        .neq('status', 'PENDING'),
    ]);
    if (students.error || parents.error || drivers.error || agencies.error) return true;
    if ((parents.count ?? 0) > 0 || (drivers.count ?? 0) > 0 || (agencies.count ?? 0) > 0) return true;
    const studentIds = ((students.data ?? []) as { id: string }[]).map((r) => r.id);
    if (studentIds.length === 0) return false;
    const { count, error } = await admin
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .in('student_id', studentIds);
    if (error) return true;
    return (count ?? 0) > 0;
  } catch {
    return true;
  }
}

/**
 * Makes sure an email can be (re)used for a fresh signup. Called only at the
 * genuine registration moment. Because ANYONE can submit a registration for any
 * email, this must never destroy a real account (audit #26):
 * - A live, CONFIRMED account → error (sign in instead).
 * - A SOFT-DELETED ("removed") account → error; it is NEVER deleted here. The
 *   owner must contact support to restore it (its bookings/payments are kept).
 * - An UNCONFIRMED leftover is removed ONLY when it is older than 24h AND owns
 *   no data (bookings, payments, operator/family rows). A fresher one means a
 *   confirmation email is already in flight → ask them to use it.
 * - Otherwise the email is free.
 * `admin` must be a service-role client.
 */
export async function ensureEmailFreeForSignup(
  admin: SupabaseClient,
  email: string,
): Promise<{ error?: string }> {
  const clean = email.trim();
  // Direct indexed lookup on profiles.email_lower (see isEmailTakenByActiveAccount)
  // — not a paged enumeration that goes blind past 1000 auth users.
  const { data: profile, error: lookupErr } = await admin
    .from('profiles')
    .select('id, is_deleted')
    .eq('email_lower', clean.toLowerCase())
    .limit(1)
    .maybeSingle();
  if (lookupErr) return { error: 'Could not check that email. Please try again.' };

  if (profile) {
    const id = (profile as { id: string }).id;
    if ((profile as { is_deleted?: boolean }).is_deleted === true) {
      return {
        error:
          'This email belongs to an account that was deactivated. Please contact support to restore it.',
      };
    }
    const { data: userRes, error: userErr } = await admin.auth.admin.getUserById(id);
    if (userErr || !userRes?.user) {
      return { error: 'Could not check that email. Please try again.' };
    }
    if (userRes.user.email_confirmed_at) {
      return { error: 'This email is already registered. Please sign in instead.' };
    }
    const createdAt = Date.parse(userRes.user.created_at ?? '');
    const stale = Number.isFinite(createdAt) && Date.now() - createdAt > STALE_UNCONFIRMED_MS;
    if (!stale) {
      return {
        error:
          'A sign-up for this email is waiting to be confirmed — use the link we emailed you, or try again in 24 hours.',
      };
    }
    if (await accountHasData(admin, id)) {
      return { error: 'This email is already linked to an account. Please contact support.' };
    }
    // Stale (>24h), never-confirmed, data-free leftover → remove the auth user
    // (cascades to its profile) so the email is available again.
    await admin.auth.admin.deleteUser(id);
  }

  // Drop any orphaned, never-approved agency row detached (owner set to null) by
  // a prior delete, so an AGENCY re-signup doesn't leave a duplicate PENDING row.
  // Only PENDING ones: an approved agency's fleet/routes/bookings must survive.
  await admin
    .from('agencies')
    .delete()
    .eq('email_lower', clean.toLowerCase()) // indexed generated column (migration 0063)
    .is('owner_profile_id', null)
    .eq('status', 'PENDING');
  return {};
}
