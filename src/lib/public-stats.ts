import { unstable_cache } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';

export type PublicStats = {
  /** Approved, non-deleted agencies. */
  providers: number;
  /** Rider base — students + parents (not deleted). */
  users: number;
  colleges: number;
  schools: number;
};

// Public, live-ish platform counts, shared by the landing stats band
// (/api/public-stats) and the signed-in pre-booking dashboards. Computed with
// the service-role client (source tables are RLS-locked to authenticated users)
// and cached for 60s in Next's data cache — keyed, NOT per request — so the 4
// COUNTs run at most ~once/minute across all traffic regardless of how many
// tabs/dashboards read them.
export const getPublicStats = unstable_cache(
  async (): Promise<PublicStats> => {
    const db = createAdminClient();
    const [providers, users, colleges, schools] = await Promise.all([
      db.from('agencies').select('id', { count: 'exact', head: true }).eq('status', 'APPROVED').eq('is_deleted', false),
      db.from('profiles').select('id', { count: 'exact', head: true }).eq('is_deleted', false).in('role', ['STUDENT', 'PARENT']),
      db.from('institutions').select('id', { count: 'exact', head: true }).eq('kind', 'COLLEGE').eq('is_active', true).eq('is_deleted', false),
      db.from('institutions').select('id', { count: 'exact', head: true }).eq('kind', 'SCHOOL').eq('is_active', true).eq('is_deleted', false),
    ]);
    // Throw on any error rather than pinning a bogus "0" in the cache for 60s.
    const err = providers.error ?? users.error ?? colleges.error ?? schools.error;
    if (err) throw err;
    return {
      providers: providers.count ?? 0,
      users: users.count ?? 0,
      colleges: colleges.count ?? 0,
      schools: schools.count ?? 0,
    };
  },
  ['public-stats-counts'],
  { revalidate: 60 },
);

/** Safe wrapper for surfaces where a stats hiccup must never break the page. */
export async function getPublicStatsSafe(): Promise<PublicStats> {
  try {
    return await getPublicStats();
  } catch {
    return { providers: 0, users: 0, colleges: 0, schools: 0 };
  }
}
