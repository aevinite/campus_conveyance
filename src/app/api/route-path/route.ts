import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { TtlCache, fetchWithTimeout } from '@/lib/geocode-cache';
import { rateLimit } from '@/lib/rate-limit';

// Road-following path through a route's stops, for the blue route line drawn on
// every bus map (src/lib/route-line.ts). Uses the free public OSRM router.
//
// Stops rarely change, so results are cached for a week keyed on the exact stop
// list — the steady state is one upstream call per route per instance. Upstream
// calls are signed-in only and capped cross-instance in the DB so the public
// OSRM demo server is never hammered. On any failure the client keeps its
// straight stop-to-stop line, so the map never breaks.
export const runtime = 'nodejs';
// Co-locate with the Supabase DB (ap-northeast-1 / Tokyo) — see src/app/layout.tsx.
export const preferredRegion = 'hnd1';

type Path = [number, number][];
const cache = new TtlCache<Path>(1000, 7 * 24 * 60 * 60 * 1000);
const MAX_STOPS = 25;

export async function GET(req: NextRequest) {
  const headers = { 'Cache-Control': 'no-store' };
  const raw = req.nextUrl.searchParams.get('pts') ?? '';
  if (raw.length > MAX_STOPS * 30) {
    return NextResponse.json({ path: null }, { status: 400, headers });
  }
  const num = /^-?\d+(\.\d+)?$/;
  const pts: [number, number][] = [];
  for (const pair of raw.split(';')) {
    const [a, b] = pair.split(',');
    if (!a || !b || !num.test(a) || !num.test(b)) {
      return NextResponse.json({ path: null }, { status: 400, headers });
    }
    const lat = parseFloat(a);
    const lng = parseFloat(b);
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return NextResponse.json({ path: null }, { status: 400, headers });
    }
    pts.push([lat, lng]);
  }
  if (pts.length < 2 || pts.length > MAX_STOPS) {
    return NextResponse.json({ path: null }, { status: 400, headers });
  }
  // ~1 m precision is plenty and keeps the cache key stable.
  const key = pts.map(([la, ln]) => `${la.toFixed(5)},${ln.toFixed(5)}`).join(';');

  const cached = cache.get(key);
  if (cached) return NextResponse.json({ path: cached }, { headers });

  const db = await createClient();
  const { data: claims } = await db.auth.getClaims();
  const sub = claims?.claims?.sub;
  if (!sub) return NextResponse.json({ path: null }, { status: 401, headers });

  if (
    (await rateLimit('rpath:caller', String(sub), 20, 60)) > 0 ||
    (await rateLimit('rpath:osrm', 'global', 4, 4, { failClosed: true })) > 0
  ) {
    return NextResponse.json({ path: cache.getStale(key) ?? null }, { headers });
  }

  try {
    const coords = pts.map(([la, ln]) => `${ln.toFixed(6)},${la.toFixed(6)}`).join(';');
    const res = await fetchWithTimeout(
      `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`,
      {
        headers: { 'User-Agent': 'CampusConveyance/1.0 (campus transport app)', Accept: 'application/json' },
        cache: 'no-store',
      },
      6000,
    );
    if (!res.ok) throw new Error('osrm');
    const j = (await res.json()) as {
      code?: string;
      routes?: { geometry?: { coordinates?: [number, number][] } }[];
    };
    const line = j.routes?.[0]?.geometry?.coordinates;
    if (j.code !== 'Ok' || !Array.isArray(line) || line.length < 2) throw new Error('osrm-shape');
    // GeoJSON is [lng, lat]; Leaflet wants [lat, lng].
    const path: Path = line.map(([ln, la]) => [la, ln]);
    cache.set(key, path);
    return NextResponse.json({ path }, { headers });
  } catch {
    return NextResponse.json({ path: cache.getStale(key) ?? null }, { headers });
  }
}
