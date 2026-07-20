import { createClient } from '@/lib/supabase/server';
import { listDriverBuses } from '@/features/driver/repository';
import { DriverLiveMap, type SimpleStop } from '@/components/driver-live-map';

// Navigation-style live map for the driver. Position comes from the phone's GPS
// (client-side); the route's stops are loaded here for on-map context.
export default async function DriverLivePage() {
  const db = await createClient();
  const buses = await listDriverBuses(db); // cached, shared with the layout
  const routeIds = [...new Set(buses.map((b) => b.route_id).filter(Boolean))] as string[];

  let stops: SimpleStop[] = [];
  if (routeIds.length > 0) {
    const { data } = await db
      .from('route_stops')
      .select('name, lat, lng, route_id, sequence')
      .in('route_id', routeIds)
      .order('sequence');
    stops = (data ?? [])
      .filter((s) => s.lat != null && s.lng != null)
      .map((s) => ({ name: s.name as string, lat: s.lat as number, lng: s.lng as number }));
  }

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Live map</h1>
        <p className="text-muted-foreground">
          Your position updates as you drive. Go online (toggle above) so students
          and parents can follow the bus in real time.
        </p>
      </div>
      <DriverLiveMap stops={stops} />
    </section>
  );
}
