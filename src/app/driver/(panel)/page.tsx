import Link from 'next/link';
import { Bus, MapPin, Route as RouteIcon, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import {
  getDriverProfile,
  listDriverBuses,
  countDriverBookings,
} from '@/features/driver/repository';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default async function DriverDashboard() {
  const db = await createClient();
  const [me, buses, riders] = await Promise.all([
    getDriverProfile(db),
    listDriverBuses(db),
    countDriverBookings(db),
  ]);
  // driver_buses is one row PER ROUTE, so a bus on two routes appears twice —
  // count DISTINCT vehicles for "Buses assigned".
  const busCount = new Set(buses.map((b) => b.vehicle_id)).size;

  const cards = [
    { label: 'Buses assigned', value: busCount, href: '/driver/buses', icon: Bus },
    { label: 'Riders (confirmed)', value: riders.confirmed, href: '/driver/riders', icon: Users },
    { label: 'Total riders', value: riders.total, href: '/driver/riders', icon: Users },
  ];

  return (
    <section className="space-y-6 sm:space-y-8">
      <div className="space-y-1">
        <p className="text-xs font-semibold tracking-wider text-primary uppercase">
          Driver dashboard
        </p>
        <h1 className="text-2xl font-heading font-bold tracking-tight sm:text-3xl">
          Welcome{me?.name ? `, ${me.name}` : ''}
        </h1>
        <p className="text-muted-foreground">
          {me?.agency_name ? `Driver at ${me.agency_name}.` : 'Your driving overview.'}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Link key={c.label} href={c.href} className="group block">
              <Card className="h-full transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
                <CardContent className="flex items-center gap-4 py-6">
                  <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                    <Icon className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="tnum text-3xl font-bold tracking-tight">{c.value}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{c.label}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <RouteIcon className="size-4 text-primary" /> Your buses &amp; routes
          </CardTitle>
        </CardHeader>
        <CardContent>
          {buses.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
                <Bus className="size-6" />
              </span>
              <p className="text-sm text-muted-foreground">
                No bus assigned to you yet. Your agency assigns you to a bus.
              </p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {buses.map((b) => (
                <li
                  key={`${b.vehicle_id}:${b.route_id ?? 'none'}`}
                  className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                      <Bus className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {b.bus_number ? `Bus ${b.bus_number}` : 'Bus'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {b.is_ac ? 'AC' : 'Non-AC'} · {b.capacity} seats
                      </p>
                    </div>
                  </div>
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground sm:text-right">
                    <MapPin className="size-3.5 shrink-0" />
                    <span>
                      {b.route_name ? `${b.route_name} → ${b.college_name ?? 'campus'}` : 'No route yet'}
                      {b.departure_time ? ` · ${b.departure_time.slice(0, 5)}` : ''}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
