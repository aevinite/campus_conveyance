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
// Co-locate with the Supabase DB (ap-northeast-1 / Tokyo) — see src/app/layout.tsx.
export const preferredRegion = 'hnd1';

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
    | { live: boolean; lat: number | null; lng: number | null; updated_at: string | null; bus_number: string | null }
    | undefined;
  if (!(row?.live && row.lat != null && row.lng != null)) {
    return NextResponse.json({ live: false }, { headers });
  }

  // Rider pickup progress (ETA badge target + "already passed" state). Only on
  // request (the map asks every ~30s, not every 5s poll) and only while live.
  // Best-effort: a failure just omits it and the map keeps its last value.
  let pickup: PickupProgress | null | undefined;
  if (new URL(req.url).searchParams.get('progress') === '1') {
    const { data: prog, error: progErr } = await db.rpc('rider_pickup_progress', { p_route_id: routeId });
    if (!progErr) pickup = pickPickup((prog ?? []) as ProgressRow[]);
  }

  return NextResponse.json(
    // updatedAt = when the DRIVER's fix was taken, so the map derives speed
    // from real fix-to-fix time (not its own poll interval).
    {
      live: true,
      lat: row.lat,
      lng: row.lng,
      updatedAt: row.updated_at,
      busNumber: row.bus_number,
      ...(pickup !== undefined ? { pickup } : {}),
    },
    { headers },
  );
}

type ProgressRow = {
  stop_name: string | null;
  lat: number | null;
  lng: number | null;
  state: string;
};

type PickupProgress = {
  name: string;
  lat: number | null;
  lng: number | null;
  /** WAITING | ON_BOARD | DONE | PASSED | NO_STOP (see rider_pickup_progress). */
  state: string;
};

// A parent may have several children on one route: track the earliest stop the
// bus hasn't reached yet; otherwise report the first row's state (passed/on board).
function pickPickup(rows: ProgressRow[]): PickupProgress | null {
  const r = rows.find((x) => x.state === 'WAITING') ?? rows[0];
  if (!r) return null;
  return { name: r.stop_name ?? 'your stop', lat: r.lat, lng: r.lng, state: r.state };
}
