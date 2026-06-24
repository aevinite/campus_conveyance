'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { registerSchema, loginSchema, forgotSchema, resetSchema } from './schemas';
import { registerUser, loginUser } from './services';
import { getSessionRole } from './session';
import { dashboardFor } from '@/lib/rbac/roles';
import { toErrorResponse, AuthError } from '@/lib/errors/app-error';

export type AuthState = { error?: string; message?: string };

export async function registerAction(
  _: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Please check the form fields.' };
  const db = await createClient();
  const site = process.env.NEXT_PUBLIC_SITE_URL!;
  try {
    await registerUser(db, parsed.data, `${site}/auth/callback`);
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
  const role = await getSessionRole(db);
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
  if (!parsed.success) return { error: 'Enter a valid email.' };
  const db = await createClient();
  const site = process.env.NEXT_PUBLIC_SITE_URL!;
  await db.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${site}/reset`,
  });
  return { message: 'If that email exists, a reset link is on its way.' };
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
  redirect('/login');
}
