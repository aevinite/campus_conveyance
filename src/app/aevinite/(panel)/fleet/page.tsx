import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Bus } from 'lucide-react';
import { listVehicles, OPS_PAGE_SIZE } from '@/features/admin/ops-repository';
import { DataTable } from '@/components/data-table';
import { StatusBadge, BoolBadge } from '@/components/status-badge';
import { Pager, pageParams } from '@/components/pager';

export const dynamic = 'force-dynamic';

export default async function AdminFleetPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, OPS_PAGE_SIZE);
  const { rows, total } = await listVehicles({ limit: OPS_PAGE_SIZE, offset });
  const totalPages = Math.max(1, Math.ceil(total / OPS_PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/aevinite/fleet?page=${totalPages}`);

  return (
    <section className="space-y-4">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <Bus className="size-3.5" />
          Fleet
        </span>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Buses &amp; Vans</h1>
        <p className="text-muted-foreground">
          Every vehicle on the platform ({total}). Open one to see its driver, documents, live location and seat roster.
        </p>
      </div>
      <DataTable
        headers={['Bus / Reg no.', 'Type', 'Capacity', 'AC', 'Provider', 'Driver', 'Active', '']}
        rows={rows.map((v) => [
          <div key="id" className="min-w-0">
            <p className="font-semibold">{v.bus_number ?? '—'}</p>
            <p className="font-mono text-xs text-muted-foreground">{v.registration_no ?? '—'}</p>
          </div>,
          v.vehicle_type === 'VAN' ? 'Van' : 'Bus',
          v.capacity ?? '—',
          <BoolBadge key="ac" value={!!v.is_ac} />,
          v.agencyName,
          <div key="drv" className="min-w-0">
            <span>{v.driver_name ?? '—'}</span>
            {v.driver_verified ? <StatusBadge value="Verified" className="ml-1.5" /> : null}
          </div>,
          <BoolBadge key="act" value={!!v.is_active} yes="Active" no="Inactive" />,
          <Link key="view" href={`/aevinite/fleet/${v.id}`} className="text-primary transition-colors hover:text-primary/70">
            View →
          </Link>,
        ])}
        empty="No vehicles registered yet."
      />
      <Pager page={page} totalPages={totalPages} basePath="/aevinite/fleet" />
    </section>
  );
}
