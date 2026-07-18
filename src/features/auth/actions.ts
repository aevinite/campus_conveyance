'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { registerSchema, loginSchema, forgotSchema, resetSchema, changePasswordSchema, profileSchema } from './schemas';
import { loginUser, ensureEmailFreeForSignup } from './services';
import { getSessionClaims } from './session';
import { isAccountDeactivated } from './account-status';
import { dashboardFor } from '@/lib/rbac/roles';
import { toErrorResponse, AuthError } from '@/lib/errors/app-error';
import { sendPasswordResetEmail, sendSignupConfirmationEmail } from '@/lib/mailer';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export type AuthState = { error?: string; message?: string };

// Caps shared across the outbound-mail actions: per address, plus a combined
// per-IP ceiling. Blocks the email-bomb / Gmail-quota-exhaustion vector.
const EMAIL_PER_ADDRESS = 3;
const EMAIL_PER_ADDRESS_WINDOW = 15 * 60;
const EMAIL_PER_IP = 20;
const EMAIL_PER_IP_WINDOW = 60 * 60;

function retryMins(seconds: number): string {
  const mins = Math.ceil(seconds / 60);
  return mins <= 1 ? 'Please wait a minute and try again.' : `Please wait about ${mins} minutes and try again.`;
}

/** Enforce per-address + per-IP email caps for `scope`. Returns an error string
 *  when the caller should stop, or undefined when it's clear to send. */
async function emailRateLimited(scope: string, email: string): Promise<string | undefined> {
  const perEmail = await rateLimit(scope, email, EMAIL_PER_ADDRESS, EMAIL_PER_ADDRESS_WINDOW);
  if (perEmail > 0) return `Too many requests for this email. ${retryMins(perEmail)}`;
  // Only apply the per-IP ceiling when we actually know the IP. On a plain
  // `next start` with no reverse proxy there's no x-forwarded-for, so every
  // visitor would share the 'unknown' bucket and one address's 20 emails/hour
  // would lock out the whole site. The per-address cap above still applies.
  const ip = await getClientIp();
  if (ip !== 'unknown') {
    const perIp = await rateLimit('email:ip', ip, EMAIL_PER_IP, EMAIL_PER_IP_WINDOW);
    if (perIp > 0) return `Too many requests. ${retryMins(perIp)}`;
  }
  return undefined;
}

export async function registerAction(
  _: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Please check the form fields.' };
  const limited = await emailRateLimited('email:signup', parsed.data.email);
  if (limited) return { error: limited };
  const site = process.env.NEXT_PUBLIC_SITE_URL!;
  // Create the account + confirmation link via the admin API (does NOT send an
  // email), then send it ourselves from Gmail — this sidesteps Supabase's
  // rate-limited built-in mailer that was blocking signups.
  const admin = createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  // Free up the email if a previous, never-confirmed signup is still holding it.
  const free = await ensureEmailFreeForSignup(admin, parsed.data.email);
  if (free.error) return { error: free.error };
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'signup',
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        full_name: parsed.data.fullName,
        role: parsed.data.role,
      },
      // Land on the client /confirm page: the confirmation session arrives in
      // the URL #hash (implicit flow), which the server /auth/callback route
      // can't read — /confirm establishes it client-side then routes to the
      // role's dashboard.
      redirectTo: `${site}/confirm`,
    },
  });
  if (error) return { error: error.message };
  try {
    await sendSignupConfirmationEmail(parsed.data.email, data.properties.action_link);
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  redirect('/verify');
}

export async function loginAction(
  _: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Please check the form fields.' };
  const db = await createClient();
  try {
    await loginUser(db, parsed.data);
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  const { userId, role } = await getSessionClaims(db);
  // Block a soft-deleted ("removed") account at the door: its credentials still
  // work and Supabase happily issues a session, but an admin has revoked it, so
  // tear the session down and refuse instead of redirecting into a dashboard.
  if (userId && (await isAccountDeactivated(db, userId, role))) {
    await db.auth.signOut();
    return { error: 'This account has been deactivated. Please contact support.' };
  }
  revalidatePath('/', 'layout');
  redirect(dashboardFor(role));
}

export async function logoutAction() {
  const db = await createClient();
  await db.auth.signOut();
  redirect('/login');
}

export async function forgotAction(
  _: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = forgotSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Enter a valid email address.' };
  const email = parsed.data.email.trim().toLowerCase();
  const site = process.env.NEXT_PUBLIC_SITE_URL!;

  // Admin (service-role) client: bypasses RLS so we can look up any account and
  // mint a one-time recovery link.
  const admin = createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // 1) Check the database: is this email registered? `profiles.email` is kept in
  // sync with auth.users by the handle_new_user trigger, so it's the source of
  // truth for "does this account exist".
  const { data: profile, error: lookupError } = await admin
    .from('profiles')
    .select('id, is_deleted, role')
    .ilike('email', email)
    .maybeSingle();
  if (lookupError) return { error: 'Something went wrong. Please try again.' };
  if (!profile) return { error: 'This email is not registered.' };

  // Don't let a soft-deleted ("removed") account reset its password and walk back
  // in. Students/parents are flagged on the profile; agencies on the agency row
  // (the owner's profile is left untouched), so check both.
  const prof = profile as { id: string; is_deleted: boolean; role: string };
  let deactivated = prof.is_deleted === true;
  if (!deactivated && prof.role === 'AGENCY') {
    const { data: agency } = await admin
      .from('agencies')
      .select('is_deleted')
      .eq('owner_profile_id', prof.id)
      .maybeSingle();
    deactivated = (agency as { is_deleted?: boolean } | null)?.is_deleted === true;
  }
  if (deactivated) {
    return { error: 'This account has been deactivated. Please contact support.' };
  }

  // Rate limit before sending (per address + per IP): reset mail on demand is an
  // email-bomb / quota-exhaustion vector.
  const limited = await emailRateLimited('email:reset', email);
  if (limited) return { error: limited };

  // 2) Registered → generate the recovery link and email it ourselves from Gmail
  // (Nodemailer) instead of Supabase's rate-limited built-in mailer. The link
  // lands on /reset, which reads the session from the URL before letting the
  // user set a new password.
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: `${site}/reset` },
  });
  if (error || !data?.properties?.action_link) {
    return { error: 'Could not create a reset link. Please try again.' };
  }
  try {
    await sendPasswordResetEmail(email, data.properties.action_link);
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  return { message: 'A reset link has been sent to your email.' };
}

export async function googleLoginAction() {
  const db = await createClient();
  const site = process.env.NEXT_PUBLIC_SITE_URL!;
  const { data, error } = await db.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${site}/auth/callback` },
  });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  if (data?.url) redirect(data.url);
}

export async function resetAction(
  _: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = resetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Password must be at least 8 characters.' };
  const db = await createClient();
  try {
    const { error } = await db.auth.updateUser({ password: parsed.data.password });
    if (error) throw new AuthError(error.message);
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  // The reset link established a RECOVERY session, so after changing the password
  // the user is actually signed in. Redirecting to /login while still logged in
  // is confusing — tear the recovery session down so /login is honest and they
  // sign in fresh with the new password.
  await db.auth.signOut();
  redirect('/login');
}

// Update the signed-in user's own profile (name + phone). Keeps the JWT's
// full_name in sync so greetings elsewhere reflect the change.
export async function updateProfileAction(
  _: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please check the form fields.' };
  }
  const { fullName, phone } = parsed.data;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return { error: 'You are not signed in.' };

  const { error } = await db
    .from('profiles')
    .update({ full_name: fullName, phone: phone ? phone : null })
    .eq('id', user.id);
  if (error) return { error: toErrorResponse(error).message };

  await db.auth.updateUser({ data: { full_name: fullName } });
  // Refresh every surface that shows the name (admin + student profiles, the
  // dashboard greeting, the header user menu).
  revalidatePath('/', 'layout');
  return { message: 'Your profile has been updated.' };
}

// Change password from inside the app: verify the current password, then set the
// new one. Used by the profile page (current → new → confirm).
export async function changePasswordAction(
  _: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = changePasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please check the form fields.' };
  }
  const { currentPassword, newPassword } = parsed.data;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user?.email) return { error: 'You are not signed in.' };

  // Verify the current password on a throwaway client so we don't disturb the
  // live session cookies while checking credentials.
  const verifier = createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  const { error: verifyErr } = await verifier.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (verifyErr) return { error: 'Your current password is incorrect.' };

  const { error } = await db.auth.updateUser({ password: newPassword });
  if (error) return { error: toErrorResponse(error).message };
  return { message: 'Your password has been updated.' };
}
