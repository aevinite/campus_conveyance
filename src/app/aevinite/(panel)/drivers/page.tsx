import { redirect } from 'next/navigation';
import Link from 'next/link';
import { IdCard } from 'lucide-react';
import { listDrivers, OPS_PAGE_SIZE } from '@/features/admin/ops-repository';
import { DataTable } from '@/components/data-table';
import { StatusBadge, BoolBadge } from '@/components/status-badge';
import { Pager, pageParams } from '@/components/pager';

export const dynamic = 'force-dynamic';

export default async function AdminDriversPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, OPS_PAGE_SIZE);
  const { rows, total } = await listDrivers({ limit: OPS_PAGE_SIZE, offset });
  const totalPages = Math.max(1, Math.ceil(total / OPS_PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/aevinite/drivers?page=${totalPages}`);

  return (
    <section className="space-y-4">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <IdCard className="size-3.5" />
          Drivers
        </span>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Drivers</h1>
        <p className="text-muted-foreground">Every driver on the platform ({total}), their provider and assigned bus.</p>
      </div>
      <DataTable
        headers={['Name', 'Contact', 'Licence no.', 'Provider', 'Bus', 'Active', 'Online', '']}
        rows={rows.map((d) => [
          <span key="n" className="font-medium">{d.name ?? '—'}</span>,
          <div key="c" className="min-w-0 text-sm">
            <p>{d.email ?? '—'}</p>
            <p className="text-muted-foreground">{d.phone ?? '—'}</p>
          </div>,
          <span key="l" className="font-mono text-xs">{d.license_no ?? '—'}</span>,
          d.agencyName,
          d.busNumber ?? '—',
          <BoolBadge key="a" value={!!d.is_active} yes="Active" no="Inactive" />,
          <StatusBadge key="o" value={d.isOnline ? 'Online' : 'Offline'} />,
          <Link key="v" href={`/aevinite/drivers/${d.id}`} className="text-primary underline-offset-4 hover:underline">
            View →
          </Link>,
        ])}
        empty="No drivers registered yet."
      />
      <Pager page={page} totalPages={totalPages} basePath="/aevinite/drivers" />
    </section>
  );
}
