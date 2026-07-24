import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Route } from 'lucide-react';
import { listRoutes, OPS_PAGE_SIZE } from '@/features/admin/ops-repository';
import { DataTable } from '@/components/data-table';
import { BoolBadge } from '@/components/status-badge';
import { Pager, pageParams } from '@/components/pager';
import { rupees } from '@/lib/format';

export const dynamic = 'force-dynamic';

// departure_time is a bare SQL `time` ("08:00:00") — no date/zone. Show HH:MM
// verbatim; running it through a timezone formatter would shift it.
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '—');

export default async function AdminRoutesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, OPS_PAGE_SIZE);
  const { rows, total } = await listRoutes({ limit: OPS_PAGE_SIZE, offset });
  const totalPages = Math.max(1, Math.ceil(total / OPS_PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/aevinite/routes?page=${totalPages}`);

  return (
    <section className="space-y-4">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <Route className="size-3.5" />
          Routes
        </span>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Routes &amp; Stops</h1>
        <p className="text-muted-foreground">
          Every route on the platform ({total}). Open one to see its stops, assigned bus, occupancy and riders.
        </p>
      </div>
      <DataTable
        headers={['Route', 'College', 'Provider', 'Bus', 'Departs', 'Fare', 'Stops', 'Active', '']}
        rows={rows.map((r) => [
          <span key="n" className="font-medium">{r.name}</span>,
          r.institutionName,
          r.agencyName,
          r.busNumber ?? '—',
          hhmm(r.departure_time),
          rupees(r.price_cents),
          <span key="sc" className="tabular-nums">{r.stopCount}</span>,
          <BoolBadge key="a" value={!!r.is_active} yes="Active" no="Inactive" />,
          <Link key="v" href={`/aevinite/routes/${r.id}`} className="text-primary underline-offset-4 hover:underline">
            View →
          </Link>,
        ])}
        empty="No routes created yet."
      />
      <Pager page={page} totalPages={totalPages} basePath="/aevinite/routes" />
    </section>
  );
}
