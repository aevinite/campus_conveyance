import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { TtlCache, photonGate, fetchWithTimeout, nominatimSlot, photonSlot } from '@/lib/geocode-cache';
import { rateLimit } from '@/lib/rate-limit';

// Server-side geocoding proxy for the pickup-stop search. Uses Photon (komoot) —
// built for location-biased autocomplete — so typing a prefix returns nearby
// matches first (e.g. "pra" near Ahmedabad → Prahlad Nagar). Falls back to
// Nominatim if Photon is unavailable. India results are preferred.
//
// This is called per keystroke, so results are cached by normalized query (+
// coarse location bias) and every upstream call goes through a shared
// per-provider throttle; a saturated throttle serves a stale/empty result
// rather than risking Nominatim's per-IP ban. See src/lib/geocode-cache.ts.
export const runtime = 'nodejs';
// Co-locate with the Supabase DB (ap-northeast-1 / Tokyo) — see src/app/layout.tsx.
export const preferredRegion = 'hnd1';

interface Suggestion {
  primary: string;
  full: string;
  lat: number;
  lng: number;
}

// Autocomplete results are stable enough to cache for a while.
const cache = new TtlCache<Suggestion[]>(3000, 60 * 60 * 1000);
// Empty result sets get a short TTL — a momentarily sparse upstream shouldn't
// pin "no matches" for the full hour.
const NEG_TTL_MS = 5 * 60 * 1000;
// A usable lat/lng location bias: numeric AND within valid earth bounds. An
// out-of-range value is ignored (no bias) rather than trusted, so it can't skew
// results or spawn junk cache keys.
const validBias = (lat: string, lon: string) => {
  const num = /^-?\d+(\.\d+)?$/;
  if (lat.length > 24 || lon.length > 24) return false; // length-cap before parse
  if (!num.test(lat) || !num.test(lon)) return false;
  const la = parseFloat(lat);
  const lo = parseFloat(lon);
  return la >= -90 && la <= 90 && lo >= -180 && lo <= 180;
};
// Key on the normalized query plus a coarse (~11 km, 1-decimal) location bias so
// nearby users share cache entries while distant biases stay distinct.
const searchKey = (q: string, lat: string, lon: string) => {
  const bias = validBias(lat, lon)
    ? `@${parseFloat(lat).toFixed(1)},${parseFloat(lon).toFixed(1)}`
    : '';
  return `${q.toLowerCase()}${bias}`;
};

const uniqJoin = (parts: (string | undefined | null)[]) => {
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

async function viaPhoton(q: string, lat: string, lon: string): Promise<Suggestion[]> {
  const bias = validBias(lat, lon) ? `&lat=${lat}&lon=${lon}` : '';
  // Check the cheap local gate FIRST, then spend a (cross-instance) DB token —
  // so a request the gate would reject doesn't waste a Photon token.
  if (!(await photonGate.acquire())) throw new Error('photon-busy');
  // 16 per 4s (= fetch timeout) bounds cross-instance CONCURRENCY to ~16.
  if ((await rateLimit('geo:photon', 'global', 16, 4, { failClosed: true })) > 0) throw new Error('photon-busy');
  const res = await photonSlot(() =>
    fetchWithTimeout(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=en${bias}`,
      { headers: { Accept: 'application/json' }, cache: 'no-store' },
    ),
  );
  if (!res.ok) throw new Error('photon');
  const json = (await res.json()) as {
    features?: {
      geometry: { coordinates: [number, number] };
      properties: Record<string, string>;
    }[];
  };
  // A 200 without a features array is malformed — throw (fall to Nominatim/stale)
  // rather than caching an empty result.
  if (!Array.isArray(json.features)) throw new Error('photon-shape');
  const feats = json.features;
  const inIndia = feats.filter((f) => (f.properties.countrycode ?? '').toUpperCase() === 'IN');
  const use = inIndia.length > 0 ? inIndia : feats;
  return use.slice(0, 6).map((f) => {
    const p = f.properties;
    return {
      primary: p.name || p.street || p.city || p.state || 'Location',
      full: uniqJoin([p.name, p.street, p.district, p.city, p.county, p.state, p.postcode, p.country]),
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
    };
  });
}

async function viaNominatim(q: string): Promise<Suggestion[]> {
  // Cross-instance cap: Nominatim allows ~1 req/s per IP. On serverless an
  // in-memory gate is per-lambda, so bound the REAL outbound rate in the DB
  // (shared 'geo:nominatim'/'global' scope, also shared with reverse-geocode).
  // Over the cap → treat as busy so the caller serves a stale/empty result.
  // 1 per 4s (= the fetch timeout) → across ALL instances at most ~1 Nominatim
  // call in flight at a time, honoring its no-parallel-use policy even if Photon
  // is down and everything falls through to Nominatim.
  if ((await rateLimit('geo:nominatim', 'global', 1, 4, { failClosed: true })) > 0) throw new Error('nominatim-busy');
  // Serialize the actual call within this instance (concurrency bound, not just
  // start-rate) so a slow upstream can't leave several open at once.
  const res = await nominatimSlot(() =>
    fetchWithTimeout(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=in&q=${encodeURIComponent(q)}`,
      { headers: { 'User-Agent': 'CampusConveyance/1.0 (campus transport app)', Accept: 'application/json' }, cache: 'no-store' },
    ),
  );
  // Throw on a transient upstream error so we don't cache empty results for 60m.
  if (!res.ok) throw new Error('nominatim');
  const data = (await res.json()) as { lat: string; lon: string; name?: string; display_name: string }[];
  // A non-array 200 (e.g. an { error } body) is malformed — throw, don't cache [].
  if (!Array.isArray(data)) throw new Error('nominatim-shape');
  return data.map((d) => ({
    primary: d.name || d.display_name.split(',')[0],
    full: d.display_name,
    lat: parseFloat(d.lat),
    lng: parseFloat(d.lon),
  }));
}

export async function GET(req: NextRequest) {
  // Per-user results; never cache in the browser/CDN (matches the sibling routes).
  const headers = { 'Cache-Control': 'no-store' };
  const sp = req.nextUrl.searchParams;
  const q = sp.get('q')?.trim() ?? '';
  // Bound the query length: a multi-KB `q` would hit upstream and pollute the
  // cache with junk keys. Real place searches are short.
  if (q.length < 2 || q.length > 120) return NextResponse.json([], { headers });

  const lat = sp.get('lat') ?? '';
  const lon = sp.get('lng') ?? sp.get('lon') ?? ''; // accept lng too (parity w/ reverse-geocode)
  const key = searchKey(q, lat, lon);

  // Cache hit → serve immediately, BEFORE auth. This keeps the (possibly
  // network-bound) getClaims() check off the per-keystroke hot path. Cached
  // values are just public OSM-derived suggestions; the auth gate below still
  // guards every UPSTREAM call, so an anonymous caller can only ever read
  // already-cached entries and can never drive a fresh Photon/Nominatim request.
  const cached = cache.get(key);
  if (cached !== undefined) return NextResponse.json(cached, { headers });

  // Cache miss → require a signed-in user before doing any upstream work
  // (avoids an open geocoding proxy).
  const db = await createClient();
  const { data: claims } = await db.auth.getClaims();
  const sub = claims?.claims?.sub;
  if (!sub) return NextResponse.json([], { status: 401, headers });

  // Per-caller cap keeps one client (or a runaway keystroke loop) from
  // monopolizing the shared upstream budget. DB-backed so it holds across
  // serverless instances. Over the cap, serve stale/empty.
  if ((await rateLimit('geo:caller', String(sub), 60, 60)) > 0) {
    return NextResponse.json(cache.getStale(key) ?? [], { headers });
  }

  // Cache the result, but never overwrite an existing GOOD (non-empty) entry with
  // an empty one — a momentarily sparse upstream shouldn't wipe a good positive.
  const cacheResults = (r: Suggestion[]) => {
    // Consult getStale (not get): even a positive entry that's PAST its TTL but
    // still in the map should win over a genuine-empty reply — otherwise getStale
    // would then serve empty over the older good label.
    if (r.length === 0 && (cache.getStale(key)?.length ?? 0) > 0) return;
    cache.set(key, r, r.length === 0 ? NEG_TTL_MS : undefined);
  };
  // `nomTried` prevents spending a SECOND geo:nominatim token: if Photon returned
  // empty and the Nominatim fallback (in the try) then threw, we must not retry it
  // in the catch — the catch's fallback is only for when PHOTON threw.
  let nomTried = false;
  try {
    let results = await viaPhoton(q, lat, lon);
    if (results.length === 0) {
      nomTried = true;
      results = await viaNominatim(q);
    }
    cacheResults(results);
    return NextResponse.json(results, { headers });
  } catch {
    if (!nomTried) {
      try {
        const results = await viaNominatim(q);
        cacheResults(results);
        return NextResponse.json(results, { headers });
      } catch {
        // fall through to stale
      }
    }
    // Upstream failed or throttle saturated — reuse stale results if any.
    return NextResponse.json(cache.getStale(key) ?? [], { headers });
  }
}
