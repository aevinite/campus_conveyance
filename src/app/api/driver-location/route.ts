import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Driver GPS ping while online. This fires every ~9s per online driver, so it's
// a lightweight API route rather than a full server action (no RSC action
// serialization / revalidation overhead on the hottest driver write path). The
// driver_update_location RPC is security-definer and keyed to auth.uid(), so it
// only ever writes the caller's own row.
export const runtime = 'nodejs';

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
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
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const db = await createClient();
  const { error } = await db.rpc('driver_update_location', { p_lat: lat, p_lng: lng });
  return NextResponse.json({ ok: !error }, { headers: { 'Cache-Control': 'no-store' } });
}
