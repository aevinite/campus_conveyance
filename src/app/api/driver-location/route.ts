import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rate-limit';
import { drainEmailOutbox } from '@/lib/email-outbox';
import { drainPushOutbox } from '@/lib/push';

// Driver GPS ping while online. This fires every ~9s per online driver, so it's
// a lightweight API route rather than a full server action (no RSC action
// serialization / revalidation overhead on the hottest driver write path). The
// driver_update_location RPC is security-definer and keyed to auth.uid(), so it
// only ever writes the caller's own row.
export const runtime = 'nodejs';
// Co-locate with the Supabase DB (ap-northeast-1 / Tokyo) — see src/app/layout.tsx.
export const preferredRegion = 'hnd1';

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

  // Arrival alerts: with the fresh fix stored, check whether the bus is now
  // within the geofence of any rider's pickup stop. The RPC returns the number
  // of riders newly alerted (bell + queued email/push rows); only drain the
  // outboxes when there's something to send, so the hot ping path stays cheap.
  // Fully best-effort — a geofence/drain failure never affects the ping result.
  if (!error) {
    try {
      const { data: alerted } = await db.rpc('check_pickup_geofence', { p_lat: lat, p_lng: lng });
      if (typeof alerted === 'number' && alerted > 0) {
        after(() => drainEmailOutbox());
        after(() => drainPushOutbox());
      }
    } catch {
      /* geofence is best-effort; the GPS fix is already saved */
    }
  }

  return NextResponse.json({ ok: !error }, { headers });
}
