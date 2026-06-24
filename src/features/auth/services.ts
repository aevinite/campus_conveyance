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
