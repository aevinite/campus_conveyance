import { cache } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Role } from '@/lib/rbac/roles';

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
 * RLS lets a user read their own profile (profiles_self) and their own agency
 * (owner_profile_id = auth.uid()), so this reads the real value under the user's
 * own session. cache() dedupes the lookup within a request, so a layout and the
 * page it wraps don't each pay for it.
 */
export const isAccountDeactivated = cache(
  async (
    db: SupabaseClient,
    userId: string,
    role: Role | undefined,
  ): Promise<boolean> => {
    const { data: profile } = await db
      .from('profiles')
      .select('is_deleted')
      .eq('id', userId)
      .maybeSingle();
    if ((profile as { is_deleted?: boolean } | null)?.is_deleted === true) {
      return true;
    }

    if (role === 'AGENCY') {
      const { data: agency } = await db
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
