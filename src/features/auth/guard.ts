import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSessionClaims } from './session';
import { isAccountDeactivated } from './account-status';
import { dashboardFor, type Role } from '@/lib/rbac/roles';

/**
 * Server-side guard for dashboard pages. Returns the user's role. SUPER_ADMIN
 * passes any gate. A single getClaims() call resolves both identity and role.
 *
 * - Not signed in → /login.
 * - Signed in but wrong role → the user's OWN dashboard (not /login), so e.g. an
 *   agency that lands on a /student page is sent back to /agency instead of being
 *   confusingly bounced to the login screen while already authenticated.
 */
export async function requireRole(allowed: Role, loginPath = '/login'): Promise<Role> {
  const db = await createClient();
  const { userId, role } = await getSessionClaims(db);
  // Not signed in → the area's OWN login screen (e.g. /aevinite/login for the
  // admin panel), not the student /login. The proxy already area-routes truly
  // unauthenticated hits; this covers the case where the layout guard runs.
  if (!userId) redirect(loginPath);
  // A soft-deleted ("removed") account keeps a valid session + JWT, so it must be
  // rejected here — the deleted flag is never in the token. Sign the stale
  // session out and bounce to login instead of letting it reach the dashboard.
  if (await isAccountDeactivated(db, userId, role)) {
    await db.auth.signOut();
    redirect(loginPath);
  }
  if (role !== allowed && role !== 'SUPER_ADMIN') {
    redirect(dashboardFor(role));
  }
  return role as Role;
}
