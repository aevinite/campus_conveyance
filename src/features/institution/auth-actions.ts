'use server';
// ---------------------------------------------------------------------------
// School / College SELF-SIGNUP + login. Mirrors the agency application flow:
// an OTP-verified registration form creates the account (role INSTITUTION_ADMIN)
// AND a hidden, unverified campus row, links the two, and emails a confirmation
// link. A SUPER_ADMIN reviews and approves the campus before it goes live
// (visible to agencies + students). Login reuses the shared signInAndRoute so a
// campus admin lands on /institution regardless of which login page they used.
// ---------------------------------------------------------------------------
import { redirect } from 'next/navigation';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { toErrorResponse } from '@/lib/errors/app-error';
import { sendSignupConfirmationEmail } from '@/lib/mailer';
import { isEmailVerified } from '@/features/agency/email-otp';
import { sendAgencyEmailOtp, verifyAgencyEmailOtp } from '@/features/agency/actions';
import { ensureEmailFreeForSignup, signInAndRoute } from '@/features/auth/services';
import { loginSchema } from '@/features/auth/schemas';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { slugify } from '@/features/admin/schemas';
import { institutionRegisterSchema } from './schemas';
import { getSiteUrl } from '@/lib/site-url';
import { createSignupIntent } from '@/features/auth/signup-intent';

export type FormState = { error?: string; message?: string };

// The email-OTP verify step is identical to the agency one (a generic 6-digit
// code + HMAC proof, no role knowledge) — reuse it so there's a single hardened
// implementation instead of a drifting copy.
export async function sendInstitutionEmailOtp(
  email: string,
): Promise<{ error?: string; token?: string }> {
  return sendAgencyEmailOtp(email);
}
export async function verifyInstitutionEmailOtp(
  email: string,
  code: string,
  token: string,
): Promise<{ error?: string; verifiedToken?: string }> {
  return verifyAgencyEmailOtp(email, code, token);
}

export async function institutionRegisterAction(
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = institutionRegisterSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ??
        'Please complete every required field correctly.',
    };
  }
  const d = parsed.data;
  // Server-side re-check of the OTP "verified" proof so the client can't skip it.
  if (!isEmailVerified(d.email, String(formData.get('emailVerifiedToken') ?? ''))) {
    return { error: 'Please verify your email address before submitting.' };
  }
  // Rate-limit the submit path (creates an auth user + mails a link) as an
  // abuse/quota guard, per-IP and per-email.
  const ip = await getClientIp();
  const busy = 'Too many registration attempts — please try again later.';
  if (ip !== 'unknown' && (await rateLimit('institution-register:ip', ip, 5, 60 * 60)) > 0) {
    return { error: busy };
  }
  if ((await rateLimit('institution-register:email', d.email, 3, 60 * 60)) > 0) {
    return { error: busy };
  }

  const site = getSiteUrl();
  // Create the account + confirmation link via the admin API (no Supabase email),
  // then mail the link ourselves from Gmail — same as the agency flow, bypassing
  // Supabase's rate-limited built-in mailer.
  const admin = createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const free = await ensureEmailFreeForSignup(admin, d.email);
  if (free.error) return { error: free.error };
  // Server-issued single-use intent: the signup trigger only grants
  // INSTITUTION_ADMIN with it (M#4), so a raw auth.signUp() can't skip the OTP
  // + form checks above.
  let signupIntent: string;
  try {
    signupIntent = await createSignupIntent(admin, d.email, 'INSTITUTION_ADMIN');
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }

  const { data, error } = await admin.auth.admin.generateLink({
    type: 'signup',
    email: d.email,
    password: d.password,
    options: {
      // Land on the client /confirm page (reads the #hash session + routes on).
      redirectTo: `${site}/confirm`,
      data: {
        // The signup trigger creates the INSTITUTION_ADMIN profile from this.
        full_name: d.contactPerson,
        role: 'INSTITUTION_ADMIN',
        signup_intent: signupIntent,
        phone: d.phone,
        campus_name: d.name,
        campus_kind: d.kind,
      },
    },
  });
  if (error) return { error: error.message };
  const uid = data.user?.id;
  if (!uid) return { error: 'Could not create the account. Please try again.' };

  // Create the campus row — HIDDEN (is_active=false) + UNVERIFIED until a
  // SUPER_ADMIN approves it — and link the new admin to it. The signup trigger
  // already made the INSTITUTION_ADMIN profile; we just add the institution and
  // point profile.institution_id at it (the access-token hook then injects it).
  const svc = createAdminClient();
  const { data: inst, error: instErr } = await svc
    .from('institutions')
    .insert({
      name: d.name,
      slug: slugify(d.name),
      kind: d.kind,
      city: d.city || null,
      area: d.area || null,
      description: d.description || null,
      image_url: d.imageUrl || null,
      contact_email: d.email,
      is_active: false,
      is_verified: false,
      // Marks this as a genuine self-registered APPLICATION (issue #12) — only
      // these appear under "Pending campus applications" and can be rejected,
      // so an admin-created college left unverified is never mistaken for one.
      self_registered: true,
    })
    .select('id')
    .single();
  if (instErr || !inst) {
    // Roll the auth user back so the email stays reusable and we don't strand an
    // admin with no campus.
    await admin.auth.admin.deleteUser(uid);
    return { error: instErr?.message ?? 'Could not create your campus. Please try again.' };
  }
  const campusId = (inst as { id: string }).id;
  const { error: linkErr } = await svc
    .from('profiles')
    // Persist the contact phone collected on the form (audit-4 LOW #17: it was
    // only stashed in auth user_metadata, which the signup trigger ignores for
    // INSTITUTION_ADMIN, so it never reached the profile).
    .update({ full_name: d.contactPerson, phone: d.phone, institution_id: campusId })
    .eq('id', uid);
  if (linkErr) {
    await svc.from('institutions').delete().eq('id', campusId);
    await admin.auth.admin.deleteUser(uid);
    return { error: linkErr.message };
  }

  try {
    await sendSignupConfirmationEmail(d.email, data.properties.action_link);
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  redirect('/institution/login?pending=1');
}

export async function institutionLoginAction(
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Please check your email and password.' };
  const db = await createClient();
  // Shared login sequence (auth + soft-delete gate + route to the account's REAL
  // role dashboard) — a campus admin lands on /institution.
  return { error: await signInAndRoute(db, parsed.data) };
}
