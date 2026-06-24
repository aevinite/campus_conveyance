import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSessionRole } from './session';
import type { Role } from '@/lib/rbac/roles';

/**
 * Server-side guard for dashboard pages. Returns the user's role, or redirects
 * to /login if not authenticated or not permitted. SUPER_ADMIN passes any gate.
 */
export async function requireRole(allowed: Role): Promise<Role> {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/login');
  const role = await getSessionRole(db);
  if (role !== allowed && role !== 'SUPER_ADMIN') redirect('/login');
  return role;
}
