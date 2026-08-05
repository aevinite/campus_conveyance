import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Ticket } from 'lucide-react';
import {
  resolveInstitutionId,
  listBookingsForInstitution,
  INSTITUTION_PAGE_SIZE,
} from '@/features/institution/repository';
import { DataTable } from '@/components/data-table';
import { StatusBadge, BoolBadge } from '@/components/status-badge';
import { Pager, pageParams } from '@/components/pager';
import { formatDateTime } from '@/lib/format-date';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const FILTERS = ['ALL', 'CONFIRMED', 'PENDING', 'CANCELLED', 'REJECTED'] as const;

export default async function InstitutionBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const { page: pageParam, status: statusParam } = await searchParams;
  const institutionId = await resolveInstitutionId();
  const status = FILTERS.includes((statusParam ?? 'ALL').toUpperCase() as (typeof FILTERS)[number])
    ? ((statusParam ?? 'ALL').toUpperCase() as (typeof FILTERS)[number])
    : 'ALL';
  const { page, offset } = pageParams(pageParam, INSTITUTION_PAGE_SIZE);

  const { rows, total } = institutionId
    ? await listBookingsForInstitution(institutionId, {
        status: status === 'ALL' ? undefined : status,
        limit: INSTITUTION_PAGE_SIZE,
        offset,
      })
    : { rows: [], total: 0 };
  const totalPages = Math.max(1, Math.ceil(total / INSTITUTION_PAGE_SIZE));
  if (total > 0 && page > totalPages) {
    redirect(`/institution/bookings?page=${totalPages}${status === 'ALL' ? '' : `&status=${status}`}`);
  }

  return (
    <section className="space-y-4">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <Ticket className="size-3.5" />
          Bookings
        </span>
        <h1 className="mt-1 text-2xl font-heading font-bold tracking-tight sm:text-3xl">Campus bookings</h1>
        <p className="text-muted-foreground">
          Every seat booked on a route to your campus ({total} {status === 'ALL' ? 'total' : status.toLowerCase()}).
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === 'ALL' ? '/institution/bookings' : `/institution/bookings?status=${f}`}
            aria-current={status === f ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-1 text-sm transition-colors',
              status === f
                ? 'border-primary bg-primary/10 font-medium text-primary'
                : 'border-border text-muted-foreground hover:bg-muted',
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
          <span key="stop" className="text-sm">
            {b.pickupStop} <span className="text-muted-foreground">→</span> {b.dropStop}
          </span>,
          <StatusBadge key="s" value={b.status} />,
          <BoolBadge key="p" value={b.isPaid} yes="Paid" no="Unpaid" />,
          formatDateTime(b.created_at),
        ])}
        empty="No bookings match this filter."
      />
      <Pager
        page={page}
        totalPages={totalPages}
        basePath="/institution/bookings"
        params={{ status: status === 'ALL' ? undefined : status }}
      />
    </section>
  );
}
