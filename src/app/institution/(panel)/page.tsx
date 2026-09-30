import Link from 'next/link';
import { resolveInstitutionId, institutionOverview } from '@/features/institution/repository';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/data-table';
import { PageHeader } from '@/components/panel/page-header';
import { StatStrip } from '@/components/panel/stat-strip';
import { requireActiveCampusPage } from '@/features/institution/page-guard';

export const dynamic = 'force-dynamic';

export default async function InstitutionDashboard() {
  if (!(await requireActiveCampusPage())) return null;
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
    { label: 'Routes serving campus', value: overview.routeCount, href: '/institution/routes' },
    { label: 'Agencies serving campus', value: overview.agencyCount, href: '/institution/agencies' },
    { label: 'Students riding', value: overview.studentsBooked, href: '/institution/riders' },
    { label: 'Seats reserved', value: overview.seats.reserved, href: '/institution/bookings' },
  ];

  const utilisation =
    overview.seats.total > 0 ? Math.round((overview.seats.reserved / overview.seats.total) * 100) : 0;

  return (
    <section className="space-y-6">
      <PageHeader
        eyebrow="Dashboard"
        title="Campus overview"
        subtitle="Transport serving your campus — routes, agencies, riders and seat utilisation."
      />

      <StatStrip items={cards.map((c) => ({ label: c.label, value: c.value, href: c.href }))} />

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
