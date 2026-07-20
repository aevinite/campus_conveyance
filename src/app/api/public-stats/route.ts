import { NextResponse } from 'next/server';
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
export const revalidate = 60;

export async function GET() {
  const db = createAdminClient();

  const [providers, users, colleges, schools] = await Promise.all([
    // Service providers = approved, non-deleted agencies.
    db.from('agencies').select('id', { count: 'exact', head: true }).eq('status', 'APPROVED').eq('is_deleted', false),
    // Trusted users = the rider base (students + parents), not deleted — NOT the
    // agency/driver/admin accounts, which aren't "users" for the marketing band.
    db.from('profiles').select('id', { count: 'exact', head: true }).eq('is_deleted', false).in('role', ['STUDENT', 'PARENT']),
    // Institutions split by kind — only ones actually visible to students
    // (active + not deleted), matching what a visitor could browse.
    db.from('institutions').select('id', { count: 'exact', head: true }).eq('kind', 'COLLEGE').eq('is_active', true).eq('is_deleted', false),
    db.from('institutions').select('id', { count: 'exact', head: true }).eq('kind', 'SCHOOL').eq('is_active', true).eq('is_deleted', false),
  ]);

  return NextResponse.json(
    {
      providers: providers.count ?? 0,
      users: users.count ?? 0,
      colleges: colleges.count ?? 0,
      schools: schools.count ?? 0,
    },
    // Cache in the browser AND shared caches for 60s (matching `revalidate`), so
    // the landing page's poll is mostly served from the browser cache and rarely
    // hits the server. `max-age` is what makes the BROWSER cache it (s-maxage
    // alone only covers CDNs); both are set so the client comment holds true.
    { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=120' } },
  );
}
