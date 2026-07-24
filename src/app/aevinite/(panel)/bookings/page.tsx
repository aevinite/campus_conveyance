import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Ticket } from 'lucide-react';
import { listBookings, OPS_PAGE_SIZE } from '@/features/admin/ops-repository';
import { DataTable } from '@/components/data-table';
import { StatusBadge, BoolBadge } from '@/components/status-badge';
import { Pager, pageParams } from '@/components/pager';
import { formatDateTime } from '@/lib/format-date';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const FILTERS = ['ALL', 'CONFIRMED', 'PENDING', 'WAITLISTED', 'CANCELLED', 'REJECTED'] as const;

export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const { page: pageParam, status: statusParam } = await searchParams;
  const status = FILTERS.includes((statusParam ?? 'ALL').toUpperCase() as (typeof FILTERS)[number])
    ? (statusParam ?? 'ALL').toUpperCase()
    : 'ALL';
  const { page, offset } = pageParams(pageParam, OPS_PAGE_SIZE);
  const { rows, total } = await listBookings({
    limit: OPS_PAGE_SIZE,
    offset,
    status: status === 'ALL' ? undefined : status,
  });
  const totalPages = Math.max(1, Math.ceil(total / OPS_PAGE_SIZE));
  if (total > 0 && page > totalPages) {
    const qs = status === 'ALL' ? '' : `&status=${status}`;
    redirect(`/aevinite/bookings?page=${totalPages}${qs}`);
  }

  return (
    <section className="space-y-4">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <Ticket className="size-3.5" />
          Bookings
        </span>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">All Bookings</h1>
        <p className="text-muted-foreground">
          Which student is booked on which bus and route ({total} {status === 'ALL' ? 'total' : status.toLowerCase()}).
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === 'ALL' ? '/aevinite/bookings' : `/aevinite/bookings?status=${f}`}
            className={cn(
              'rounded-full border px-3 py-1 text-sm transition-colors',
              status === f ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border text-muted-foreground hover:bg-muted',
            )}
          >
            {f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
          </Link>
        ))}
      </div>

      <DataTable
        headers={['Student', 'Route', 'Bus', 'Pickup → Drop', 'Status', 'Paid', 'Booked']}
        rows={rows.map((b) => [
          <div key="st" className="min-w-0">
            <p className="font-medium">{b.studentName ?? '—'}</p>
            <p className="text-xs text-muted-foreground">{b.studentEmail ?? '—'}</p>
          </div>,
          b.routeName,
          b.busNumber ?? '—',
          <span key="stop" className="text-sm">{b.pickupStop} <span className="text-muted-foreground">→</span> {b.dropStop}</span>,
          <StatusBadge key="s" value={b.status} />,
          <BoolBadge key="p" value={b.isPaid} yes="Paid" no="Unpaid" />,
          formatDateTime(b.created_at),
        ])}
        empty="No bookings match this filter."
      />
      <Pager
        page={page}
        totalPages={totalPages}
        basePath="/aevinite/bookings"
        params={{ status: status === 'ALL' ? undefined : status }}
      />
    </section>
  );
}
