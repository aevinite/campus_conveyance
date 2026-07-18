import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Server-side geocoding proxy for the pickup-stop search. Uses Photon (komoot) —
// built for location-biased autocomplete — so typing a prefix returns nearby
// matches first (e.g. "pra" near Ahmedabad → Prahlad Nagar). Falls back to
// Nominatim if Photon is unavailable. India results are preferred.

interface Suggestion {
  primary: string;
  full: string;
  lat: number;
  lng: number;
}

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
  const bias = /^-?\d+(\.\d+)?$/.test(lat) && /^-?\d+(\.\d+)?$/.test(lon) ? `&lat=${lat}&lon=${lon}` : '';
  const res = await fetch(
    `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=en${bias}`,
    { headers: { Accept: 'application/json' }, cache: 'no-store' },
  );
  if (!res.ok) throw new Error('photon');
  const json = (await res.json()) as {
    features?: {
      geometry: { coordinates: [number, number] };
      properties: Record<string, string>;
    }[];
  };
  const feats = json.features ?? [];
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
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=in&q=${encodeURIComponent(q)}`,
    { headers: { 'User-Agent': 'CampusConveyance/1.0 (campus transport app)', Accept: 'application/json' }, cache: 'no-store' },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { lat: string; lon: string; name?: string; display_name: string }[];
  return (Array.isArray(data) ? data : []).map((d) => ({
    primary: d.name || d.display_name.split(',')[0],
    full: d.display_name,
    lat: parseFloat(d.lat),
    lng: parseFloat(d.lon),
  }));
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get('q')?.trim() ?? '';
  if (q.length < 2) return NextResponse.json([]);

  // Only for signed-in users (avoids an open geocoding proxy).
  const db = await createClient();
  const { data: claims } = await db.auth.getClaims();
  if (!claims?.claims?.sub) return NextResponse.json([], { status: 401 });

  const lat = sp.get('lat') ?? '';
  const lon = sp.get('lon') ?? '';
  try {
    const results = await viaPhoton(q, lat, lon);
    if (results.length > 0) return NextResponse.json(results);
    return NextResponse.json(await viaNominatim(q));
  } catch {
    try {
      return NextResponse.json(await viaNominatim(q));
    } catch {
      return NextResponse.json([]);
    }
  }
}
