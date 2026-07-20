import Link from 'next/link';
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
    { label: 'Buses assigned', value: busCount, href: '/driver/buses' },
    { label: 'Riders (confirmed)', value: riders.confirmed, href: '/driver/riders' },
    { label: 'Total riders', value: riders.total, href: '/driver/riders' },
  ];

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Welcome{me?.name ? `, ${me.name}` : ''}</h1>
        <p className="text-muted-foreground">
          {me?.agency_name ? `Driver at ${me.agency_name}.` : 'Your driving overview.'}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <Link key={c.label} href={c.href}>
            <Card className="transition-colors hover:border-primary/40">
              <CardContent className="py-6">
                <p className="text-3xl font-bold text-primary">{c.value}</p>
                <p className="mt-1 text-sm text-muted-foreground">{c.label}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your buses &amp; routes</CardTitle>
        </CardHeader>
        <CardContent>
          {buses.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No bus assigned to you yet. Your agency assigns you to a bus.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {buses.map((b) => (
                <li
                  key={`${b.vehicle_id}:${b.route_id ?? 'none'}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card/40 p-3"
                >
                  <span className="font-medium">
                    {b.bus_number ? `Bus ${b.bus_number}` : 'Bus'}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {b.is_ac ? 'AC' : 'Non-AC'} · {b.capacity} seats
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    {b.route_name ? `${b.route_name} → ${b.college_name ?? 'campus'}` : 'No route yet'}
                    {b.departure_time ? ` · ${b.departure_time.slice(0, 5)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
