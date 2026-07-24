import { Bus, MapPin, Route as RouteIcon } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { listDriverRouteProgress, type DriverRouteStop } from '@/features/driver/repository';
import { Card, CardContent } from '@/components/ui/card';
import { RouteProgressControl } from './route-progress-control';

// Driver marks stops as new bookings arrive, so never cache this page.
export const dynamic = 'force-dynamic';

export default async function DriverStopsPage() {
  const db = await createClient();
  const stops = await listDriverRouteProgress(db);

  // Group the flat rows into one section per route (already ordered by
  // bus/route/sequence from the RPC).
  const groups: { key: string; busNumber: string | null; routeName: string | null; stops: DriverRouteStop[] }[] = [];
  for (const s of stops) {
    let g = groups.find((x) => x.key === s.route_id);
    if (!g) {
      g = { key: s.route_id, busNumber: s.bus_number, routeName: s.route_name, stops: [] };
      groups.push(g);
    }
    g.stops.push(s);
  }

  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <p className="text-xs font-semibold tracking-wider text-primary uppercase">Today</p>
        <h1 className="text-2xl font-heading font-bold tracking-tight sm:text-3xl">Route progress</h1>
        <p className="text-muted-foreground">
          Pick the pickup slot you&apos;re heading to next, or skip a stop you can&apos;t reach —
          riders waiting there are told to move to the next stop.
        </p>
      </div>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <Bus className="size-6" />
            </span>
            <p className="text-sm text-muted-foreground">
              No route with pickup stops assigned to you today.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <Card key={g.key} className="overflow-hidden">
              <CardContent className="space-y-4 py-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 font-heading text-lg font-semibold">
                    <Bus className="size-4 text-primary" />
                    {g.busNumber ? `Bus ${g.busNumber}` : 'Bus'}
                  </span>
                  {g.routeName && (
                    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                      <RouteIcon className="size-3.5" /> {g.routeName}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                    <MapPin className="size-3.5" /> {g.stops.length} stop
                    {g.stops.length === 1 ? '' : 's'}
                  </span>
                </div>
                <RouteProgressControl stops={g.stops} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
