import Link from 'next/link';
import { Building2, Route, Users, Ticket, LayoutDashboard } from 'lucide-react';
import { resolveInstitutionId, institutionOverview } from '@/features/institution/repository';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/data-table';

export const dynamic = 'force-dynamic';

export default async function InstitutionDashboard() {
  const institutionId = await resolveInstitutionId();
  // The layout renders a "no campus linked" gate when this is null, so children
  // only ever mount with a real id — but stay defensive.
  const overview = institutionId
    ? await institutionOverview(institutionId)
    : {
        routeCount: 0,
        agencyCount: 0,
        studentsBooked: 0,
        seats: { total: 0, reserved: 0, available: 0 },
        perRoute: [] as { routeId: string; routeName: string; students: number; total: number; available: number }[],
      };

  const cards = [
    { label: 'Routes serving campus', value: overview.routeCount, href: '/institution/routes', icon: Route },
    { label: 'Agencies serving campus', value: overview.agencyCount, href: '/institution/agencies', icon: Building2 },
    { label: 'Students riding', value: overview.studentsBooked, href: '/institution/riders', icon: Users },
    { label: 'Seats reserved', value: overview.seats.reserved, href: '/institution/bookings', icon: Ticket },
  ];

  const utilisation =
    overview.seats.total > 0 ? Math.round((overview.seats.reserved / overview.seats.total) * 100) : 0;

  return (
    <section className="space-y-6">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <LayoutDashboard className="size-3.5" />
          Dashboard
        </span>
        <h1 className="mt-1 text-2xl font-heading font-bold tracking-tight sm:text-3xl">Campus overview</h1>
        <p className="mt-1 text-muted-foreground">
          Transport serving your campus — routes, agencies, riders and seat utilisation.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="group">
            <Card className="h-full transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/40 group-hover:shadow-md">
              <CardContent className="flex items-start justify-between gap-3 py-6">
                <div className="min-w-0">
                  <p className="tnum text-2xl font-bold text-gradient sm:text-3xl">{c.value}</p>
                  <p className="mt-1 truncate text-sm text-muted-foreground">{c.label}</p>
                </div>
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground sm:size-11">
                  <c.icon className="size-5" />
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Seat utilisation</CardTitle>
          <p className="text-sm text-muted-foreground">
            {overview.seats.reserved} of {overview.seats.total} seats reserved across your campus routes ({utilisation}%).
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${utilisation}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span className="tnum">{overview.seats.reserved} reserved</span>
            <span className="tnum">{overview.seats.available} available</span>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Per-route utilisation</h2>
        <DataTable
          headers={['Route', 'Students', 'Reserved', 'Available', 'Total seats']}
          rows={overview.perRoute.map((r) => [
            <Link
              key="r"
              href="/institution/routes"
              className="font-medium text-primary transition-colors hover:text-primary/70"
            >
              {r.routeName}
            </Link>,
            <span key="s" className="tnum">{r.students}</span>,
            <span key="res" className="tnum">{Math.max(r.total - r.available, 0)}</span>,
            <span key="av" className="tnum">{r.available}</span>,
            <span key="t" className="tnum">{r.total}</span>,
          ])}
          empty="No active routes serve your campus yet."
        />
      </div>
    </section>
  );
}
