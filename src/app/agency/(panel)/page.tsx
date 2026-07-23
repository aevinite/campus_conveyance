import Link from 'next/link';
import { Bus, ClipboardList, IndianRupee, Route, TrendingUp, Users, Wallet } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getMyAgency, getAgencyReport } from '@/features/agency/repository';
import { formatDateTime } from '@/lib/format-date';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart } from '@/components/charts/bar-chart';
import { DonutChart } from '@/components/charts/donut-chart';
import { DownloadReportButton } from '@/components/download-report-button';

export default async function AgencyDashboard() {
  const db = await createClient();
  const agency = await getMyAgency(db);
  const report = agency
    ? await getAgencyReport(agency.id)
    : {
        counts: { services: 0, buses: 0, routes: 0, pending: 0 },
        fleet: { buses: 0, vans: 0 },
        fleetByCollege: [],
        routesByInstitution: [],
        bookings: { pending: 0, confirmed: 0, rejected: 0, cancelled: 0, total: 0 },
        studentsCount: 0,
        revenue: { todayCents: 0, monthCents: 0, totalCents: 0, byRoute: [] },
        generatedAt: new Date().toISOString(),
      };
  const { counts, fleetByCollege, routesByInstitution, bookings, studentsCount, revenue } = report;
  const inr = (cents: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
      (cents || 0) / 100,
    );

  const cards = [
    { label: 'Buses & vans', value: counts.buses, href: '/agency/buses', icon: Bus },
    { label: 'Routes', value: counts.routes, href: '/agency/routes', icon: Route },
    { label: 'Active students', value: studentsCount, href: '/agency/students', icon: Users },
    { label: 'Pending bookings', value: counts.pending, href: '/agency/bookings', icon: ClipboardList },
  ];

  const fleetData = fleetByCollege.map((c) => ({
    label: c.name,
    values: { buses: c.buses, vans: c.vans },
  }));
  const routeData = routesByInstitution.map((r) => ({
    label: r.name,
    values: { routes: r.routes },
  }));

  const generated = formatDateTime(report.generatedAt);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">Dashboard</span>
          <h1 className="mt-1 text-2xl font-heading font-bold tracking-tight sm:text-3xl">
            {agency ? `${agency.name}` : 'Service Provider Dashboard'}
          </h1>
          <p className="mt-1 text-muted-foreground">Overview of your fleet, routes and bookings.</p>
          <p className="print-only mt-1 text-sm text-muted-foreground">Generated {generated}</p>
        </div>
        <DownloadReportButton />
      </div>

      {/* Headline counts */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="print-block group">
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

      {/* Revenue */}
      <Card className="print-block">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IndianRupee className="size-4 text-primary" /> Revenue
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Earnings from paid bookings you have confirmed (unpaid bookings never count).
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <RevStat label="Today" value={inr(revenue.todayCents)} icon={TrendingUp} />
            <RevStat label="This month" value={inr(revenue.monthCents)} icon={Wallet} />
            <RevStat label="All-time" value={inr(revenue.totalCents)} icon={IndianRupee} accent />
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Revenue by route</p>
            {revenue.byRoute.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No confirmed bookings yet — accept a booking in Manage Booking to earn revenue.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2.5 font-medium">Route</th>
                      <th className="px-4 py-2.5 text-right font-medium">Confirmed bookings</th>
                      <th className="px-4 py-2.5 text-right font-medium">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {revenue.byRoute.map((r) => (
                      <tr key={r.name} className="transition-colors hover:bg-secondary/30">
                        <td className="px-4 py-2.5">{r.name}</td>
                        <td className="tnum px-4 py-2.5 text-right">{r.bookings}</td>
                        <td className="tnum px-4 py-2.5 text-right">{inr(r.revenueCents)}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold">
                      <td className="px-4 py-2.5">Total</td>
                      <td className="tnum px-4 py-2.5 text-right">
                        {revenue.byRoute.reduce((s, r) => s + r.bookings, 0)}
                      </td>
                      <td className="tnum px-4 py-2.5 text-right">{inr(revenue.totalCents)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Buses & vans at each college/school */}
        <Card className="print-block h-full">
          <CardHeader>
            <CardTitle>Buses &amp; vans by school / college</CardTitle>
            <p className="text-sm text-muted-foreground">
              What you run at each of the {fleetByCollege.length} school{fleetByCollege.length === 1 ? '' : 's'} /
              colleges you serve
            </p>
          </CardHeader>
          <CardContent>
            <BarChart
              data={fleetData}
              series={[
                { key: 'buses', label: 'Buses', color: 'var(--viz-bus)' },
                { key: 'vans', label: 'Vans', color: 'var(--viz-van)' },
              ]}
              emptyLabel="No routes yet — add a route to a college to see this."
            />
          </CardContent>
        </Card>

        {/* Routes per school/college */}
        <Card className="print-block h-full">
          <CardHeader>
            <CardTitle>Routes by school / college</CardTitle>
            <p className="text-sm text-muted-foreground">
              {counts.routes} routes across {routesByInstitution.length} institutions
            </p>
          </CardHeader>
          <CardContent>
            <BarChart
              data={routeData}
              series={[{ key: 'routes', label: 'Routes', color: 'var(--viz-students)' }]}
              emptyLabel="No routes added yet."
            />
          </CardContent>
        </Card>
      </div>

      {/* Bookings */}
      <Card className="print-block">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="size-4 text-primary" /> Bookings
          </CardTitle>
          <p className="text-sm text-muted-foreground">Status of bookings placed with your services.</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <DonutChart
            segments={[
              { label: 'Confirmed', value: bookings.confirmed, color: 'var(--viz-paid)' },
              { label: 'Pending', value: bookings.pending, color: 'var(--viz-pending)' },
              { label: 'Rejected', value: bookings.rejected, color: 'var(--destructive)' },
              { label: 'Cancelled', value: bookings.cancelled, color: 'var(--muted-foreground)' },
            ]}
            centerValue={String(bookings.total)}
            centerLabel="bookings"
          />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-4">
            <Stat label="Confirmed" value={String(bookings.confirmed)} />
            <Stat label="Pending" value={String(bookings.pending)} />
            <Stat label="Rejected" value={String(bookings.rejected)} />
            <Stat label="Cancelled by student" value={String(bookings.cancelled)} />
          </div>
        </CardContent>
      </Card>

      {/* Per-college fleet table (also anchors the printed report) */}
      <Card className="print-block">
        <CardHeader>
          <CardTitle>Fleet by school / college</CardTitle>
          <p className="text-sm text-muted-foreground">
            Buses and vans you provide at each college/school you serve.
          </p>
        </CardHeader>
        <CardContent>
          {fleetByCollege.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No routes yet. Add a route to a college and it will appear here.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">School / College</th>
                    <th className="px-4 py-2.5 text-right font-medium">Buses</th>
                    <th className="px-4 py-2.5 text-right font-medium">Vans</th>
                    <th className="px-4 py-2.5 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {fleetByCollege.map((c) => (
                    <tr key={c.name} className="transition-colors hover:bg-secondary/30">
                      <td className="px-4 py-2.5">{c.name}</td>
                      <td className="tnum px-4 py-2.5 text-right">{c.buses}</td>
                      <td className="tnum px-4 py-2.5 text-right">{c.vans}</td>
                      <td className="tnum px-4 py-2.5 text-right">{c.buses + c.vans}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="px-4 py-2.5">Total</td>
                    <td className="tnum px-4 py-2.5 text-right">
                      {fleetByCollege.reduce((s, c) => s + c.buses, 0)}
                    </td>
                    <td className="tnum px-4 py-2.5 text-right">
                      {fleetByCollege.reduce((s, c) => s + c.vans, 0)}
                    </td>
                    <td className="tnum px-4 py-2.5 text-right">
                      {fleetByCollege.reduce((s, c) => s + c.buses + c.vans, 0)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-3 transition-colors hover:border-primary/30">
      <p className="tnum text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function RevStat({
  label,
  value,
  icon: Icon,
  accent = false,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border p-4 ${accent ? 'border-primary/40 bg-primary/5' : 'border-border bg-card/40'}`}
    >
      <span
        className={`grid size-10 shrink-0 place-items-center rounded-xl ${accent ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'}`}
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`tnum mt-0.5 truncate text-2xl font-bold ${accent ? 'text-primary' : ''}`}>{value}</p>
      </div>
    </div>
  );
}
