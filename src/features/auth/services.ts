import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LoginInput } from './schemas';
import { getSessionClaims } from './session';
import { isAccountDeactivated } from './account-status';
import { dashboardFor } from '@/lib/rbac/roles';
import { AuthError, toErrorResponse } from '@/lib/errors/app-error';
import { getClientIp, registerLoginAttempt, clearLoginFailures } from '@/lib/rate-limit';

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
  const subject = `${input.email.trim().toLowerCase()}|${await getClientIp()}`;
  if ((await registerLoginAttempt(subject)) > 0) {
    return 'Too many failed attempts. Please wait a few minutes and try again.';
  }
  try {
    await loginUser(db, input);
  } catch (e) {
    return toErrorResponse(e).message; // attempt already counted atomically
  }
  await clearLoginFailures(subject); // successful login resets the counter
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
 * Makes sure an email can be (re)used for a fresh signup.
 * - If a live, CONFIRMED account already uses it → returns an error (real user).
 * - If a leftover UNCONFIRMED account uses it (an abandoned signup that was never
 *   verified) → hard-deletes it so the email frees up.
 * - If a SOFT-DELETED account uses it (the admin panels "delete" a student/agency
 *   by setting profiles.is_deleted = true but leave the auth user in place, so a
 *   confirmed-but-deleted account keeps holding its email) → hard-deletes the
 *   stale auth user so the address can be reused for a brand-new account.
 * - Otherwise the email is free.
 * `admin` must be a service-role client.
 */
export async function ensureEmailFreeForSignup(
  admin: SupabaseClient,
  email: string,
): Promise<{ error?: string }> {
  const clean = email.trim();
  // Direct indexed lookup on profiles.email_lower (see isEmailTakenByActiveAccount)
  // — not a paged enumeration that goes blind past 1000 auth users (which silently
  // broke re-signup) and not a case-insensitive ilike seq scan.
  const { data: profile } = await admin
    .from('profiles')
    .select('id, is_deleted')
    .eq('email_lower', clean.toLowerCase())
    .limit(1)
    .maybeSingle();

  if (profile) {
    const id = (profile as { id: string }).id;
    const softDeleted = (profile as { is_deleted?: boolean }).is_deleted === true;
    const { data: userRes } = await admin.auth.admin.getUserById(id);
    const confirmed = Boolean(userRes?.user?.email_confirmed_at);
    if (confirmed && !softDeleted) {
      return { error: 'This email is already registered. Please sign in instead.' };
    }
    // Never-confirmed leftover OR a soft-deleted account → remove the auth user
    // (cascades to its profile) so the email is available again.
    await admin.auth.admin.deleteUser(id);
  }

  // Drop any orphaned agency row detached (owner set to null) by a prior delete,
  // so an AGENCY re-signup doesn't leave a duplicate PENDING row behind.
  await admin
    .from('agencies')
    .delete()
    .eq('email_lower', clean.toLowerCase()) // indexed generated column (migration 0063)
    .is('owner_profile_id', null);
  return {};
}
