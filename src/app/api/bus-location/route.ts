import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rate-limit';

// Live bus location for a route the caller is booked on (or is a linked parent
// of). Polled by the student route map. The RPC is gated + returns coords only
// while the driver is online and the fix is fresh, so this route just forwards.
// Cookie-authed + real-time, so it must run per-request (never statically
// optimized). Declared explicitly to match the other API routes rather than
// relying on the cookie-triggered dynamic default.
export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  // Real-time — never cache, on every path (success, error, bad input).
  const headers = { 'Cache-Control': 'no-store' };
  const routeId = new URL(req.url).searchParams.get('routeId');
  // Validate the shape before hitting the DB so a malformed id fails fast as a
  // 400 instead of surfacing as a Postgres 22P02 (invalid uuid) error.
  if (!routeId || !UUID_RE.test(routeId)) {
    return NextResponse.json({ live: false }, { status: 400, headers });
  }

  const db = await createClient();
  // Gate + throttle like the other hot routes. The RPC is already auth.uid()-
  // gated, but check here too so anon gets a clean 401 (not a 500) and an
  // authenticated client can't hammer the multi-join RPC uncapped. ~12 polls/min
  // per open map; 300/min ≈ 25 concurrent route maps before a 429 (a parent can
  // legitimately track several children on distinct routes at once).
  const { data: claims } = await db.auth.getClaims();
  const sub = claims?.claims?.sub;
  if (!sub) return NextResponse.json({ live: false }, { status: 401, headers });
  if ((await rateLimit('bus-loc', String(sub), 300, 60)) > 0) {
    return NextResponse.json({ live: false }, { status: 429, headers });
  }

  const { data, error } = await db.rpc('bus_live_location', { p_route_id: routeId });
  if (error) {
    return NextResponse.json({ live: false }, { status: 500, headers });
  }
  const row = (data ?? [])[0] as
    | { live: boolean; lat: number | null; lng: number | null; bus_number: string | null }
    | undefined;
  return NextResponse.json(
    row?.live && row.lat != null && row.lng != null
      ? { live: true, lat: row.lat, lng: row.lng, busNumber: row.bus_number }
      : { live: false },
    { headers },
  );
}
