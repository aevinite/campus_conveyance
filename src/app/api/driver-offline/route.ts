import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rate-limit';

// Beacon target for the driver-tracker: flips the driver offline when the tab is
// really being torn down (close / hard-nav away), so the live map stops instead
// of waiting out the 2-minute freshness window. sendBeacon sends same-origin
// cookies, so driver_set_online runs as the signed-in driver.
export const runtime = 'nodejs';
// Co-locate with the Supabase DB (ap-northeast-1 / Tokyo) — see src/app/layout.tsx.
export const preferredRegion = 'hnd1';

export async function POST() {
  const headers = { 'Cache-Control': 'no-store' }; // never cache, any path
  const db = await createClient();
  // Explicit auth gate: don't rely solely on the RPC's internal auth.uid()
  // check — stays correct even if the RPC signature ever changes.
  const { data: claims } = await db.auth.getClaims();
  const sub = claims?.claims?.sub;
  if (!sub) {
    return NextResponse.json({ ok: false }, { status: 401, headers });
  }
  // Throttle like the other authed hot routes (this is a beacon; a driver fires
  // it rarely). Fails open on a store error so a genuine sign-off isn't blocked.
  if ((await rateLimit('driver-offline', String(sub), 30, 60)) > 0) {
    return NextResponse.json({ ok: false }, { status: 429, headers });
  }
  const { error } = await db.rpc('driver_set_online', { p_online: false });
  return NextResponse.json({ ok: !error }, { headers });
}
