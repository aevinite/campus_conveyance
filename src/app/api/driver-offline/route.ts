import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Beacon target for the driver-tracker: flips the driver offline when the tab is
// really being torn down (close / hard-nav away), so the live map stops instead
// of waiting out the 2-minute freshness window. sendBeacon sends same-origin
// cookies, so driver_set_online runs as the signed-in driver.
export const runtime = 'nodejs';

export async function POST() {
  const db = await createClient();
  const { error } = await db.rpc('driver_set_online', { p_online: false });
  return NextResponse.json({ ok: !error }, { headers: { 'Cache-Control': 'no-store' } });
}
