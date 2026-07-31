import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';

// Public, live-ish counts for the landing-page stats band. Computed with the
// service-role client because the source tables are RLS-locked to authenticated
// users, and this endpoint is hit by anonymous visitors.
//
// SCALE: this is the single hottest anonymous path, so it must NOT scale with
// visitor count. Two guards:
//   1. The route response is cached for 60s (revalidate), so no matter how many
//      tabs poll it, the DB is queried at most ~once per minute — shared across
//      all visitors — instead of once per tab per poll.
//   2. `count: 'exact'` — the numbers are cheap to compute at this scale and the
//      60s cache already bounds DB load to ~once/minute regardless of traffic.
//      (Estimated counts read as 0/low on a freshly-seeded DB until Postgres
//      runs ANALYZE, which made the marketing band understate real numbers.)
export const runtime = 'nodejs';
// Co-locate with the Supabase DB (ap-northeast-1 / Tokyo) — see src/app/layout.tsx.
export const preferredRegion = 'hnd1';
export const revalidate = 60;

// Authoritative DB-load cap: the 4 counts run at most once per 60s, keyed in the
// data cache — NOT per request URL. This holds even when a client appends a
// cache-busting query string or sends `no-cache` (which can otherwise defeat the
// route/HTTP cache and re-run every count on every hit). Shared across instances
// via Next's data cache.
const getCounts = unstable_cache(
  async () => {
    const db = createAdminClient();
    const [providers, users, colleges, schools] = await Promise.all([
      // Service providers = approved, non-deleted agencies.
      db.from('agencies').select('id', { count: 'exact', head: true }).eq('status', 'APPROVED').eq('is_deleted', false),
      // Trusted users = the rider base (students + parents), not deleted — NOT the
      // agency/driver/admin accounts, which aren't "users" for the marketing band.
      db.from('profiles').select('id', { count: 'exact', head: true }).eq('is_deleted', false).in('role', ['STUDENT', 'PARENT']),
      // Institutions split by kind — only ones actually visible to students.
      db.from('institutions').select('id', { count: 'exact', head: true }).eq('kind', 'COLLEGE').eq('is_active', true).eq('is_deleted', false),
      db.from('institutions').select('id', { count: 'exact', head: true }).eq('kind', 'SCHOOL').eq('is_active', true).eq('is_deleted', false),
    ]);
    // If any count errored, THROW rather than returning it as 0 — otherwise
    // unstable_cache would pin a bogus "0" (or an understated band) for the full
    // 60s window. Throwing leaves the data cache empty so the next hit retries.
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

export async function GET() {
  try {
    return NextResponse.json(
      await getCounts(),
      // Cache in the browser AND shared caches for 60s (matching `revalidate`), so
      // the landing page's poll is mostly served from the browser cache and rarely
      // hits the server. `max-age` is what makes the BROWSER cache it (s-maxage
      // alone only covers CDNs); both are set so the client comment holds true.
      { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=120' } },
    );
  } catch {
    // A DB hiccup shouldn't throw a bare 500 (which ships with no Cache-Control,
    // so every anonymous tab would immediately re-hit and amplify the outage).
    // Return safe zeros with a SHORT cache so the band degrades gracefully and
    // self-heals on the next request once the DB recovers.
    return NextResponse.json(
      { providers: 0, users: 0, colleges: 0, schools: 0 },
      { status: 200, headers: { 'Cache-Control': 'public, max-age=10, s-maxage=10' } },
    );
  }
}
