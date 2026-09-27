import Link from 'next/link';
import { Bus, MapPin, Route as RouteIcon, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { isAppRequest } from '@/lib/app-context';
import {
  getDriverProfile,
  listDriverBuses,
  countDriverBookings,
} from '@/features/driver/repository';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/panel/page-header';
import { StatStrip } from '@/components/panel/stat-strip';

export default async function DriverDashboard() {
  const db = await createClient();
  const [me, buses, riders, app] = await Promise.all([
    getDriverProfile(db),
    listDriverBuses(db),
    countDriverBookings(db),
    isAppRequest(),
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
      <PageHeader
        eyebrow={app ? undefined : 'Driver dashboard'}
        title={`Welcome${me?.name ? `, ${me.name}` : ''}`}
        subtitle={me?.agency_name ? `Driver at ${me.agency_name}.` : 'Your driving overview.'}
      />

      {app ? (
        // Compact 3-up stat chips (stacked-card grid is too tall on a phone).
        <div className="grid grid-cols-3 gap-3">
          {cards.map((c) => {
            const Icon = c.icon;
            return (
              <Link key={c.label} href={c.href} className="block">
                <Card className="h-full">
                  <CardContent className="flex flex-col items-center gap-1 px-2 py-4 text-center">
                    <Icon className="size-5 text-primary" />
                    <p className="tnum text-2xl font-bold leading-none">{c.value}</p>
                    <p className="text-[11px] leading-tight text-muted-foreground">{c.label}</p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      ) : (
        <StatStrip
          cols={3}
          items={cards.map((c) => ({ label: c.label, value: c.value, href: c.href }))}
        />
      )}

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
