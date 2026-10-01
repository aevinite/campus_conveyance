import 'server-only';
import { randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Privileged-role signup intents (audit M#4, migration 0133).
 *
 * The handle_new_user trigger only grants AGENCY / INSTITUTION_ADMIN / DRIVER
 * when the new auth user carries `user_metadata.signup_intent` matching an
 * unexpired row in `signup_role_intents` for the same email + role. Only the
 * service role can write that table, so a direct `auth.signUp()` with
 * `{ role: 'AGENCY' }` metadata (skipping the OTP + form checks) lands as a
 * plain STUDENT. Call this AFTER the action's own checks, right before creating
 * the user, and spread the returned token into the user metadata:
 *
 *   const signup_intent = await createSignupIntent(admin, email, 'AGENCY');
 *   ...data: { role: 'AGENCY', signup_intent, ... }
 *
 * The trigger consumes (deletes) the row, so a token is single-use; unused rows
 * expire after 15 minutes. `admin` must be a service-role client.
 */
export type PrivilegedSignupRole = 'AGENCY' | 'INSTITUTION_ADMIN' | 'DRIVER';

export async function createSignupIntent(
  admin: SupabaseClient,
  email: string,
  role: PrivilegedSignupRole,
): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const { error } = await admin
    .from('signup_role_intents')
    .insert({ email_lower: email.trim().toLowerCase(), role, token });
  if (error) throw new Error('Could not start the account setup. Please try again.');
  return token;
}
