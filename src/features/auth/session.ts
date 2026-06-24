import type { SupabaseClient } from '@supabase/supabase-js';
import { roleFromClaims, type Role } from '@/lib/rbac/roles';

/**
 * The user's role lives in the JWT claims (injected by the custom access-token
 * hook), NOT in getUser().app_metadata (which reflects the DB record only).
 * getClaims() returns the verified token payload, so we read the role from
 * there.
 */
export async function getSessionRole(
  db: SupabaseClient,
): Promise<Role | undefined> {
  const { data } = await db.auth.getClaims();
  const appMetadata = (data?.claims as { app_metadata?: unknown } | null)
    ?.app_metadata;
  return roleFromClaims(appMetadata);
}
