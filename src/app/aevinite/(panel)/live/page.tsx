import { Radio, Bus } from 'lucide-react';
import { listOnlineBuses, listRideEvents, OPS_PAGE_SIZE } from '@/features/admin/ops-repository';
import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { Pager, pageParams } from '@/components/pager';
import { formatDateTime } from '@/lib/format-date';
import { relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function AdminLivePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, OPS_PAGE_SIZE);
  const [online, events] = await Promise.all([
    listOnlineBuses(),
    listRideEvents({ limit: OPS_PAGE_SIZE, offset }),
  ]);
  const totalPages = Math.max(1, Math.ceil(events.total / OPS_PAGE_SIZE));

  return (
    <section className="space-y-6">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <Radio className="size-3.5" />
          Live
        </span>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Live Rides</h1>
        <p className="text-muted-foreground">
          Buses online right now and the latest boarding activity. Reload to refresh.
        </p>
      </div>

      <div className="space-y-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Bus className="size-5 text-primary" /> Buses online now ({online.length})
        </h2>
        <DataTable
          headers={['Bus', 'Driver', 'Coordinates', 'Last ping']}
          rows={online.map((o) => [
            <div key="b" className="min-w-0">
              <p className="font-semibold">{o.busNumber ?? '—'}</p>
              <p className="font-mono text-xs text-muted-foreground">{o.registration_no ?? '—'}</p>
            </div>,
            o.driverName ?? '—',
            o.lat != null && o.lng != null ? (
              <span key="c" className="font-mono text-xs">{o.lat.toFixed(5)}, {o.lng.toFixed(5)}</span>
            ) : (
              '—'
            ),
            o.updated_at ? relativeTime(o.updated_at) : '—',
          ])}
          empty="No buses are online right now."
        />
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Boarding activity</h2>
        <DataTable
          headers={['Student', 'Route', 'Event', 'When']}
          rows={events.rows.map((e) => [
            e.studentName ?? '—',
            e.routeName,
            <StatusBadge key="s" value={e.stage} />,
            formatDateTime(e.recorded_at),
          ])}
          empty="No boarding events recorded yet."
        />
        <Pager page={page} totalPages={totalPages} basePath="/aevinite/live" />
      </div>
    </section>
  );
}
