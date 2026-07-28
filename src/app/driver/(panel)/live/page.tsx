import { Navigation } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { isAppRequest } from '@/lib/app-context';
import { listDriverBuses } from '@/features/driver/repository';
import { DriverLiveMap, type SimpleStop } from '@/components/driver-live-map';

// Navigation-style live map for the driver. Position comes from the phone's GPS
// (client-side); the route's stops are loaded here for on-map context.
export default async function DriverLivePage() {
  const db = await createClient();
  const [buses, app] = await Promise.all([listDriverBuses(db), isAppRequest()]); // buses cached, shared with the layout
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

  if (app) {
    // App: a big, full-bleed navigation map — the screen's focus. A one-line
    // header keeps everything above the fold; the map fills the rest.
    return (
      <section className="space-y-3">
        <div className="flex items-center gap-1.5">
          <Navigation className="size-4 text-primary" />
          <h1 className="text-lg font-heading font-bold tracking-tight">Live map</h1>
        </div>
        {/* -mx-4 cancels the layout's page padding so the map spans edge to edge. */}
        <div className="-mx-4">
          <DriverLiveMap stops={stops} heightClass="h-[calc(100dvh-15rem)] min-h-[62vh]" bleed />
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <p className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wider text-primary uppercase">
          <Navigation className="size-3.5" /> Navigation
        </p>
        <h1 className="text-2xl font-heading font-bold tracking-tight sm:text-3xl">Live map</h1>
        <p className="text-muted-foreground">
          Your position updates as you drive. Go online (toggle above) so students
          and parents can follow the bus in real time.
        </p>
      </div>
      <DriverLiveMap stops={stops} />
    </section>
  );
}
