import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { AppError } from '@/lib/errors/app-error';

/**
 * True only for a signed-in SUPER_ADMIN whose profile is live. Checks the
 * profile row (service role), not the JWT claim — the claim can lag a demotion
 * or a deactivation by up to an hour.
 */
export async function isActiveSuperAdmin(): Promise<boolean> {
  const db = await createClient();
  const { data } = await db.auth.getClaims();
  const uid = (data?.claims as { sub?: string } | null)?.sub;
  if (!uid) return false;
  const { data: prof } = await createAdminClient()
    .from('profiles')
    .select('role, is_deleted')
    .eq('id', uid)
    .maybeSingle();
  const p = prof as { role: string; is_deleted: boolean } | null;
  return !!p && p.role === 'SUPER_ADMIN' && !p.is_deleted;
}

/**
 * Hard gate for admin server actions (a server action is a public POST
 * endpoint, so the panel's layout guard alone doesn't protect it).
 */
export async function assertSuperAdmin(): Promise<void> {
  if (!(await isActiveSuperAdmin())) {
    throw new AppError('ADMIN', 'Only a super admin can do this.');
  }
}
