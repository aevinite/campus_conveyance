import { NextResponse } from 'next/server';
import { getPublicStats } from '@/lib/public-stats';

// Public, live-ish counts for the landing-page stats band. The actual query +
// 60s data-cache live in src/lib/public-stats.ts (getPublicStats) so the
// signed-in pre-booking dashboards can reuse the exact same cached counts
// server-side without a self-HTTP call. This route just exposes them to the
// anonymous landing page.
export const runtime = 'nodejs';
// Co-locate with the Supabase DB (ap-northeast-1 / Tokyo) — see src/app/layout.tsx.
export const preferredRegion = 'hnd1';
export const revalidate = 60;

export async function GET() {
  try {
    return NextResponse.json(
      await getPublicStats(),
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
