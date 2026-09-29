import { cache } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Role } from '@/lib/rbac/roles';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * True when the signed-in account has been soft-deleted ("deleted"/removed) by an
 * admin and must therefore lose ALL access — even though its auth user and login
 * session still exist. The admin panels only flip a flag; they never remove the
 * auth user, and the JWT carries no such flag. So access has to be re-checked
 * against the database at every gate (login, requireRole, the dashboard layout,
 * forgot-password) rather than trusted from the token — otherwise a removed
 * student/agency simply reuses its cookie and walks back in.
 *
 * The flag lives in a different table per role:
 *   - students / parents / institution admins → profiles.is_deleted
 *   - agencies → agencies.is_deleted (deleting an agency leaves the owner's
 *     profile row untouched, so AGENCY users must be checked on the agency row)
 *
 * Read with the SERVICE-ROLE client: since 0129 the database itself rejects every
 * API call from a deactivated account (PostgREST pre-request check), so a read
 * under the user's own session would just error — and fail open. cache() dedupes
 * the lookup within a request, so a layout and the page it wraps don't each pay.
 */
export const isAccountDeactivated = cache(
  async (
    db: SupabaseClient,
    userId: string,
    role: Role | undefined,
  ): Promise<boolean> => {
    void db;
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from('profiles')
      .select('is_deleted')
      .eq('id', userId)
      .maybeSingle();
    if ((profile as { is_deleted?: boolean } | null)?.is_deleted === true) {
      return true;
    }

    if (role === 'AGENCY') {
      const { data: agency } = await admin
        .from('agencies')
        .select('is_deleted')
        .eq('owner_profile_id', userId)
        .maybeSingle();
      if ((agency as { is_deleted?: boolean } | null)?.is_deleted === true) {
        return true;
      }
    }
    return false;
  },
);
