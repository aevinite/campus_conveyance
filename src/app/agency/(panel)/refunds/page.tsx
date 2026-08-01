import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMyAgency, listAgencyRefunds, countAgencyRefunds } from '@/features/agency/repository';
import { DataTable } from '@/components/data-table';
import { Pager, pageParams } from '@/components/pager';
import { formatDateTime } from '@/lib/format-date';

const PAGE_SIZE = 20;

const inr = (cents: number) => `₹${Math.round((cents ?? 0) / 100).toLocaleString('en-IN')}`;

const STATUS: Record<string, { label: string; cls: string }> = {
  REQUESTED: { label: 'Refund pending', cls: 'border-warning/30 bg-warning/10 text-warning' },
  PROCESSED: { label: 'Refunded', cls: 'border-success/30 bg-success/10 text-success' },
  DECLINED: { label: 'Declined', cls: 'border-destructive/30 bg-destructive/10 text-destructive' },
};

export default async function AgencyRefundsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, PAGE_SIZE);
  const db = await createClient();
  const agency = await getMyAgency(db);
  const [rows, total] = agency
    ? await Promise.all([
        listAgencyRefunds(db, agency.id, { limit: PAGE_SIZE, offset }),
        countAgencyRefunds(db, agency.id),
      ])
    : [[], 0];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/agency/refunds?page=${totalPages}`);

  return (
    <section className="space-y-4">
      <div>
        <span className="text-xs font-semibold uppercase tracking-widest text-primary">Payments</span>
        <h1 className="mt-1 text-2xl font-heading font-bold tracking-tight sm:text-3xl">
          Cancellations &amp; refunds
        </h1>
        <p className="text-muted-foreground">
          Riders who cancelled a paid booking on your routes ({total}) — their reason and refund
          details. Refunds are issued by Campus Conveyance; this is for your records.
        </p>
      </div>
      <DataTable
        headers={['Rider', 'Route', 'Paid', 'Refund to', 'Reason', 'Cancelled', 'Status']}
        rows={rows.map((r) => {
          const meta = STATUS[r.refundStatus] ?? { label: r.refundStatus, cls: 'border-border bg-muted text-muted-foreground' };
          return [
            <div key="s" className="min-w-0">
              <p className="font-medium">{r.studentName ?? '—'}</p>
              {r.studentEmail && <p className="truncate text-xs text-muted-foreground">{r.studentEmail}</p>}
            </div>,
            r.routeName,
            <span key="a" className="tnum font-semibold">{inr(r.amountCents)}</span>,
            <div key="p" className="min-w-0 text-sm">
              <p className="font-medium">{r.payoutMethod ?? '—'}</p>
              <p className="break-all font-mono text-xs text-muted-foreground">{r.payoutDetails ?? '—'}</p>
            </div>,
            <span key="r" className="block max-w-xs text-sm text-muted-foreground">{r.reason ?? '—'}</span>,
            r.requestedAt ? formatDateTime(r.requestedAt) : '—',
            <div key="st" className="space-y-1">
              <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${meta.cls}`}>
                {meta.label}
              </span>
              {r.refundStatus === 'PROCESSED' && r.refundAmountCents != null && (
                <p className="tnum text-xs text-muted-foreground">{inr(r.refundAmountCents)} refunded</p>
              )}
            </div>,
          ];
        })}
        empty="No cancellations with a refund yet."
      />
      <Pager page={page} totalPages={totalPages} basePath="/agency/refunds" />
    </section>
  );
}
