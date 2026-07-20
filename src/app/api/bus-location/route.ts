import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Live bus location for a route the caller is booked on (or is a linked parent
// of). Polled by the student route map. The RPC is gated + returns coords only
// while the driver is online and the fix is fresh, so this route just forwards.
export async function GET(req: Request) {
  const routeId = new URL(req.url).searchParams.get('routeId');
  if (!routeId) {
    return NextResponse.json({ live: false }, { status: 400 });
  }
  const db = await createClient();
  const { data, error } = await db.rpc('bus_live_location', { p_route_id: routeId });
  if (error) {
    return NextResponse.json({ live: false });
  }
  const row = (data ?? [])[0] as
    | { live: boolean; lat: number | null; lng: number | null; bus_number: string | null }
    | undefined;
  return NextResponse.json(
    row?.live && row.lat != null && row.lng != null
      ? { live: true, lat: row.lat, lng: row.lng, busNumber: row.bus_number }
      : { live: false },
    // Never cache — this is real-time.
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
