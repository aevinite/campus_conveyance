import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rate-limit';

// Driver GPS ping while online. This fires every ~9s per online driver, so it's
// a lightweight API route rather than a full server action (no RSC action
// serialization / revalidation overhead on the hottest driver write path). The
// driver_update_location RPC is security-definer and keyed to auth.uid(), so it
// only ever writes the caller's own row.
export const runtime = 'nodejs';

// A legit driver posts ~1 fix / 9s (~7/min). Cap well above that so normal
// clients never hit it, but a misbehaving/forged client can't hammer the write.
const MAX_PER_MIN = 30;

export async function POST(req: Request) {
  const headers = { 'Cache-Control': 'no-store' }; // real-time — never cache, any path
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400, headers });
  }
  const { lat, lng } = (body ?? {}) as { lat?: unknown; lng?: unknown };
  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return NextResponse.json({ ok: false }, { status: 400, headers });
  }

  // Explicit auth gate: don't rely solely on the RPC's internal auth.uid()
  // check. It also gives us the driver id to key the write throttle on.
  const db = await createClient();
  const { data: claims } = await db.auth.getClaims();
  const sub = claims?.claims?.sub;
  if (!sub) return NextResponse.json({ ok: false }, { status: 401, headers });

  // DB-backed so the cap holds across serverless instances (this route already
  // hits the DB to write the fix, so it's one extra shared-state check, not a new
  // dependency). rateLimit() fails open on a store error — never blocks a real
  // driver ping over a limiter outage.
  if ((await rateLimit('driver-loc', String(sub), MAX_PER_MIN, 60)) > 0) {
    return NextResponse.json({ ok: false }, { status: 429, headers });
  }

  const { error } = await db.rpc('driver_update_location', { p_lat: lat, p_lng: lng });
  return NextResponse.json({ ok: !error }, { headers });
}
