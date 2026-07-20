import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Reverse-geocode a live GPS position to a short "area" label (e.g.
// "Prahlad Nagar, Ahmedabad") for the moving-bus readout. Reuses the same free
// OpenStreetMap providers as the pickup-stop search: Photon first, Nominatim as
// fallback. Signed-in only, so it isn't an open proxy. Callers throttle this
// (only when the bus moves a meaningful distance), so volume stays low.
export const runtime = 'nodejs';

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
  const res = await fetch(
    `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&lang=en`,
    { headers: { Accept: 'application/json' }, cache: 'no-store' },
  );
  if (!res.ok) throw new Error('photon');
  const json = (await res.json()) as {
    features?: { properties: Record<string, string> }[];
  };
  const p = json.features?.[0]?.properties;
  if (!p) return null;
  const label = uniq([
    p.name || p.street || p.district || p.locality,
    p.city || p.county || p.state,
  ]);
  return label || null;
}

async function viaNominatim(lat: string, lon: string): Promise<string | null> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&addressdetails=1&lat=${lat}&lon=${lon}`,
    {
      headers: {
        'User-Agent': 'CampusConveyance/1.0 (campus transport app)',
        Accept: 'application/json',
      },
      cache: 'no-store',
    },
  );
  if (!res.ok) return null;
  const d = (await res.json()) as { address?: Record<string, string>; name?: string };
  const a = d.address ?? {};
  const label = uniq([
    a.neighbourhood || a.suburb || a.road || d.name,
    a.city || a.town || a.village || a.state_district || a.state,
  ]);
  return label || null;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const lat = sp.get('lat') ?? '';
  const lon = sp.get('lng') ?? sp.get('lon') ?? '';
  const num = /^-?\d+(\.\d+)?$/;
  if (!num.test(lat) || !num.test(lon)) {
    return NextResponse.json({ area: null }, { status: 400 });
  }

  const db = await createClient();
  const { data: claims } = await db.auth.getClaims();
  if (!claims?.claims?.sub) return NextResponse.json({ area: null }, { status: 401 });

  const headers = { 'Cache-Control': 'no-store' };
  try {
    const area = await viaPhoton(lat, lon);
    if (area) return NextResponse.json({ area }, { headers });
    return NextResponse.json({ area: await viaNominatim(lat, lon) }, { headers });
  } catch {
    try {
      return NextResponse.json({ area: await viaNominatim(lat, lon) }, { headers });
    } catch {
      return NextResponse.json({ area: null }, { headers });
    }
  }
}
