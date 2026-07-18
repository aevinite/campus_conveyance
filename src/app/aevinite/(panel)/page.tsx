import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getAdminReport } from '@/features/admin/repository';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart } from '@/components/charts/bar-chart';
import { DonutChart } from '@/components/charts/donut-chart';
import { DownloadReportButton } from '@/components/download-report-button';

const inr = (cents: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
    (cents || 0) / 100,
  );

export default async function AdminDashboard() {
  const db = await createClient();
  const report = await getAdminReport(db);
  const { counts, providers, totals, payments } = report;

  const cards = [
    { label: 'Pending requests', value: counts.requests, href: '/aevinite/requests' },
    { label: 'Service providers', value: counts.agencies, href: '/aevinite/providers' },
    { label: 'Students', value: counts.students, href: '/aevinite/students' },
    { label: 'Colleges & schools', value: counts.colleges, href: '/aevinite/colleges' },
  ];

  const fleetData = providers.map((p) => ({
    id: p.agencyId,
    label: p.name,
    values: { buses: p.buses, vans: p.vans },
  }));
  const studentData = providers.map((p) => ({ id: p.agencyId, label: p.name, values: { students: p.students } }));

  const totalBookings = payments.paidCount + payments.unpaidCount;
  const generated = new Date(report.generatedAt).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Admin Report &amp; Dashboard</h1>
          <p className="text-muted-foreground">Platform overview across all service providers.</p>
          <p className="print-only mt-1 text-sm text-muted-foreground">Generated {generated}</p>
        </div>
        <DownloadReportButton />
      </div>

      {/* Headline counts */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="print-block">
            <Card className="transition-colors hover:border-primary/40">
              <CardContent className="py-6">
                <p className="text-3xl font-bold text-primary">{c.value}</p>
                <p className="mt-1 text-sm text-muted-foreground">{c.label}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Fleet per provider */}
        <Card className="print-block">
          <CardHeader>
            <CardTitle>Fleet by service provider</CardTitle>
            <p className="text-sm text-muted-foreground">
              {totals.buses} buses · {totals.vans} vans across {providers.length} providers
            </p>
          </CardHeader>
          <CardContent>
            <BarChart
              data={fleetData}
              series={[
                { key: 'buses', label: 'Buses', color: 'var(--viz-bus)' },
                { key: 'vans', label: 'Vans', color: 'var(--viz-van)' },
              ]}
              emptyLabel="No approved providers with vehicles yet."
            />
          </CardContent>
        </Card>

        {/* Students per provider */}
        <Card className="print-block">
          <CardHeader>
            <CardTitle>Students by service provider</CardTitle>
            <p className="text-sm text-muted-foreground">
              {totals.students} active riders across all providers
            </p>
          </CardHeader>
          <CardContent>
            <BarChart
              data={studentData}
              series={[{ key: 'students', label: 'Students', color: 'var(--viz-students)' }]}
              emptyLabel="No active bookings yet."
            />
          </CardContent>
        </Card>
      </div>

      {/* Payments */}
      <Card className="print-block">
        <CardHeader>
          <CardTitle>Payments</CardTitle>
          <p className="text-sm text-muted-foreground">
            Fee collection across all active bookings (based on the route fare and the
            booking&apos;s paid status).
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <DonutChart
            segments={[
              { label: 'Paid', value: payments.paidCount, color: 'var(--viz-paid)' },
              { label: 'Unpaid', value: payments.unpaidCount, color: 'var(--viz-pending)' },
            ]}
            centerValue={String(totalBookings)}
            centerLabel="bookings"
          />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-2">
            <Stat label="Paid" value={String(payments.paidCount)} sub={inr(payments.paidCents) + ' collected'} />
            <Stat label="Unpaid" value={String(payments.unpaidCount)} sub={inr(payments.unpaidCents) + ' due'} />
            <Stat label="Total billed" value={inr(payments.paidCents + payments.unpaidCents)} />
            <Stat label="Bookings" value={String(totalBookings)} />
          </div>
        </CardContent>
      </Card>

      {/* Per-provider detail table (also anchors the printed report) */}
      <Card className="print-block">
        <CardHeader>
          <CardTitle>Service provider details</CardTitle>
        </CardHeader>
        <CardContent>
          {providers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No approved service providers yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Service provider</th>
                    <th className="py-2 pr-4 text-right font-medium">Buses</th>
                    <th className="py-2 pr-4 text-right font-medium">Vans</th>
                    <th className="py-2 pr-4 text-right font-medium">Students</th>
                  </tr>
                </thead>
                <tbody>
                  {providers.map((p) => (
                    <tr key={p.agencyId} className="border-b border-border/60">
                      <td className="py-2 pr-4">{p.name}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{p.buses}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{p.vans}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{p.students}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="py-2 pr-4">Total</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{totals.buses}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{totals.vans}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{totals.students}</td>
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

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/40 p-3">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
