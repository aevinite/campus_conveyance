import type { SupabaseClient } from '@supabase/supabase-js';
import type { RegisterInput, LoginInput } from './schemas';
import { AuthError } from '@/lib/errors/app-error';

export async function registerUser(
  db: SupabaseClient,
  input: RegisterInput,
  redirectTo: string,
) {
  const { error } = await db.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: redirectTo,
      data: { full_name: input.fullName, role: input.role },
    },
  });
  if (error) throw new AuthError(error.message);
}

export async function loginUser(db: SupabaseClient, input: LoginInput) {
  const { error } = await db.auth.signInWithPassword(input);
  if (error) throw new AuthError(error.message);
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
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = data?.users.find(
    (u) => (u.email ?? '').toLowerCase() === email.toLowerCase(),
  );
  if (!existing) return false;
  if (!existing.email_confirmed_at) return false; // never-confirmed leftover → not a live account
  const { data: profile } = await admin
    .from('profiles')
    .select('is_deleted')
    .eq('id', existing.id)
    .maybeSingle();
  if ((profile as { is_deleted?: boolean } | null)?.is_deleted === true) return false; // soft-deleted → not live
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
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = data?.users.find(
    (u) => (u.email ?? '').toLowerCase() === email.toLowerCase(),
  );
  if (!existing) return {};

  // Is the matching account still active, or was it "deleted"? The admin panels
  // soft-delete via profiles.is_deleted rather than removing the auth user, so
  // check that flag before deciding the email is genuinely taken.
  const { data: profile } = await admin
    .from('profiles')
    .select('is_deleted')
    .eq('id', existing.id)
    .maybeSingle();
  const softDeleted = profile?.is_deleted === true;

  if (existing.email_confirmed_at && !softDeleted) {
    return { error: 'This email is already registered. Please sign in instead.' };
  }

  // Never-confirmed leftover OR a soft-deleted account → remove the auth user
  // (cascades to its profile) so the email is available again. Also drop any
  // orphaned agency row that was detached (owner set to null) by a prior delete,
  // so an AGENCY re-signup doesn't leave a duplicate PENDING row behind.
  await admin.auth.admin.deleteUser(existing.id);
  await admin
    .from('agencies')
    .delete()
    .ilike('email', email)
    .is('owner_profile_id', null);
  return {};
}
