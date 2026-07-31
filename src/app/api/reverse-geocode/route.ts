import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { TtlCache, photonGate, fetchWithTimeout, nominatimSlot, photonSlot } from '@/lib/geocode-cache';
import { rateLimit } from '@/lib/rate-limit';

// Reverse-geocode a live GPS position to a short "area" label (e.g.
// "Prahlad Nagar, Ahmedabad") for the moving-bus readout. Reuses the same free
// OpenStreetMap providers as the pickup-stop search: Photon first, Nominatim as
// fallback. Signed-in only, so it isn't an open proxy.
//
// This fires as the bus moves, so it's the biggest source of outbound geocoding
// load. Protection (see src/lib/geocode-cache.ts): results are cached on a
// grid-rounded coordinate key so a bus staying in the same ~100 m cell reuses
// one lookup; every upstream call goes through a per-provider throttle; and if
// the throttle is saturated we serve a stale cached area (or null) rather than
// risk Nominatim's per-IP ban.
export const runtime = 'nodejs';
// Co-locate with the Supabase DB (ap-northeast-1 / Tokyo) — see src/app/layout.tsx.
export const preferredRegion = 'hnd1';

// Areas are effectively static — cache generously. ~100 m grid (3 decimals).
const cache = new TtlCache<string | null>(2000, 24 * 60 * 60 * 1000);
// A structurally-valid but EMPTY result (no area found) is cached only briefly —
// a momentarily sparse upstream shouldn't pin "no area" for the full 24h.
const NEG_TTL_MS = 5 * 60 * 1000;
const gridKey = (lat: number, lon: number) => `${lat.toFixed(3)},${lon.toFixed(3)}`;

const uniq = (parts: (string | undefined | null)[]) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const v = (p ?? '').trim();
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out.join(', ');
};

async function viaPhoton(lat: string, lon: string): Promise<string | null> {
  // Check the cheap local gate FIRST, then spend a cross-instance DB token, so a
  // gate-rejected request doesn't waste a Photon token.
  if (!(await photonGate.acquire())) throw new Error('photon-busy');
  // 16 per 4s (= fetch timeout) bounds cross-instance CONCURRENCY to ~16 (not
  // just start-rate), so scale-out can't leave ~4×N Photon calls in flight.
  if ((await rateLimit('geo:photon', 'global', 16, 4, { failClosed: true })) > 0) throw new Error('photon-busy');
  const res = await photonSlot(() =>
    fetchWithTimeout(
      `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&lang=en`,
      { headers: { Accept: 'application/json' }, cache: 'no-store' },
    ),
  );
  if (!res.ok) throw new Error('photon');
  const json = (await res.json()) as {
    features?: { properties: Record<string, string> }[];
  };
  // Validate shape: a 200 without a features array is a malformed/error body —
  // throw (fall to stale) rather than caching it as a permanent "no area".
  if (!Array.isArray(json.features)) throw new Error('photon-shape');
  const p = json.features[0]?.properties;
  if (!p) return null; // genuine empty result — OK to cache

  const label = uniq([
    p.name || p.street || p.district || p.locality,
    p.city || p.county || p.state,
  ]);
  return label || null;
}

async function viaNominatim(lat: string, lon: string): Promise<string | null> {
  // Cross-instance cap: Nominatim allows ~1 req/s per IP. On serverless an
  // in-memory gate is per-lambda, so bound the REAL outbound rate in the DB
  // (shared 'geo:nominatim'/'global' scope, also shared with geocode). Over the
  // cap → treat as busy so the caller serves the last stale area (or null).
  // 1 per 4s (= the fetch timeout) → at most ~1 in-flight Nominatim call across
  // all instances, honoring its no-parallel-use policy.
  if ((await rateLimit('geo:nominatim', 'global', 1, 4, { failClosed: true })) > 0) throw new Error('nominatim-busy');
  // Bound concurrency within the instance (see nominatimSlot).
  const res = await nominatimSlot(() =>
    fetchWithTimeout(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&addressdetails=1&lat=${lat}&lon=${lon}`,
      {
        headers: {
          'User-Agent': 'CampusConveyance/1.0 (campus transport app)',
          Accept: 'application/json',
        },
        cache: 'no-store',
      },
    ),
  );
  // Throw (don't return null) on a transient upstream error, so the caller falls
  // to the stale/last-value path instead of caching "no area" for the full 24h.
  if (!res.ok) throw new Error('nominatim');
  const d = (await res.json()) as { address?: Record<string, string>; name?: string; error?: unknown };
  // Nominatim can return a 200 with an { error } body — throw (fall to stale)
  // instead of caching it as "no area".
  if (!d || typeof d !== 'object' || 'error' in d) throw new Error('nominatim-shape');
  const a = d.address ?? {};
  const label = uniq([
    a.neighbourhood || a.suburb || a.road || d.name,
    a.city || a.town || a.village || a.state_district || a.state,
  ]);
  return label || null;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const headers = { 'Cache-Control': 'no-store' };
  const lat = sp.get('lat') ?? '';
  const lon = sp.get('lng') ?? sp.get('lon') ?? '';
  // Length-cap FIRST so a pathological param never reaches parseFloat/regex.
  if (lat.length > 24 || lon.length > 24) {
    return NextResponse.json({ area: null }, { status: 400, headers });
  }
  const num = /^-?\d+(\.\d+)?$/;
  const latN = parseFloat(lat);
  const lonN = parseFloat(lon);
  // Reject non-numeric OR out-of-range coordinates — a bad point would otherwise
  // waste a cache slot and an upstream lookup that can only 404.
  if (
    !num.test(lat) || !num.test(lon) ||
    latN < -90 || latN > 90 || lonN < -180 || lonN > 180
  ) {
    return NextResponse.json({ area: null }, { status: 400, headers });
  }
  const key = gridKey(latN, lonN);

  // Cache hit → serve immediately, BEFORE auth. Keeps the (possibly
  // network-bound) getClaims() check off the per-bus-move hot path. Cached area
  // labels are public OSM-derived data; the auth gate below still guards every
  // UPSTREAM call, so an anonymous caller can only read already-cached labels
  // and can never drive a fresh Photon/Nominatim request.
  const cached = cache.get(key);
  if (cached !== undefined) return NextResponse.json({ area: cached }, { headers });

  // Cache miss → require a signed-in user before doing any upstream work.
  const db = await createClient();
  const { data: claims } = await db.auth.getClaims();
  const sub = claims?.claims?.sub;
  if (!sub) return NextResponse.json({ area: null }, { status: 401, headers });

  // Per-caller cap: one signed-in client shouldn't monopolize the shared
  // upstream budget. DB-backed so it holds across serverless instances. Over the
  // cap, serve the last stale value (or null).
  if ((await rateLimit('rgeo:caller', String(sub), 30, 60)) > 0) {
    return NextResponse.json({ area: cache.getStale(key) ?? null }, { headers });
  }

  // Never overwrite a good (non-null) area with null — a sparse upstream shouldn't
  // wipe a known label.
  const cacheArea = (a: string | null) => {
    // getStale (not get): keep an older good label — even past its TTL — over a
    // genuine-null reply, else getStale would then serve null over it.
    if (a === null && cache.getStale(key)) return; // a truthy positive still present
    cache.set(key, a, a === null ? NEG_TTL_MS : undefined);
  };
  // `nomTried` avoids spending a SECOND geo:nominatim token when Photon returned
  // null and the Nominatim fallback (in the try) then threw.
  let nomTried = false;
  try {
    let area = await viaPhoton(lat, lon);
    if (area === null) {
      nomTried = true;
      area = await viaNominatim(lat, lon);
    }
    cacheArea(area);
    return NextResponse.json({ area }, { headers });
  } catch {
    if (!nomTried) {
      try {
        const area = await viaNominatim(lat, lon);
        cacheArea(area);
        return NextResponse.json({ area }, { headers });
      } catch {
        // fall through to stale
      }
    }
    // Upstream failed or throttle saturated — reuse a stale area if we have one,
    // else null. Never propagate the load spike upstream.
    return NextResponse.json({ area: cache.getStale(key) ?? null }, { headers });
  }
}
