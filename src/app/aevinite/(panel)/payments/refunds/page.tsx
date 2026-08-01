import { redirect } from 'next/navigation';
import Link from 'next/link';
import { IndianRupee } from 'lucide-react';
import { listPendingRefunds, OPS_PAGE_SIZE } from '@/features/admin/ops-repository';
import { processRefundAction } from '@/features/admin/ops-actions';
import { DataTable } from '@/components/data-table';
import { Pager, pageParams } from '@/components/pager';
import { formatDateTime } from '@/lib/format-date';

export const dynamic = 'force-dynamic';

const inr = (cents: number) => `₹${Math.round((cents ?? 0) / 100).toLocaleString('en-IN')}`;

// Tab links shared with the verify + history pages.
function Tabs({ active }: { active: 'verify' | 'history' | 'refunds' }) {
  const base = 'rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors';
  const on = 'bg-primary text-primary-foreground';
  const off = 'text-muted-foreground hover:text-foreground';
  return (
    <div className="inline-flex rounded-xl border border-border bg-card p-1">
      <Link href="/aevinite/payments" className={`${base} ${active === 'verify' ? on : off}`}>To verify</Link>
      <Link href="/aevinite/payments/refunds" className={`${base} ${active === 'refunds' ? on : off}`}>Refunds</Link>
      <Link href="/aevinite/payments/history" className={`${base} ${active === 'history' ? on : off}`}>Completed</Link>
    </div>
  );
}

export default async function AdminRefundsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, OPS_PAGE_SIZE);
  const { rows, total } = await listPendingRefunds({ limit: OPS_PAGE_SIZE, offset });
  const totalPages = Math.max(1, Math.ceil(total / OPS_PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/aevinite/payments/refunds?page=${totalPages}`);

  return (
    <section className="space-y-4">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <IndianRupee className="size-3.5" />
          Payments
        </span>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Refunds to process</h1>
        <p className="text-muted-foreground">
          Riders who cancelled a paid booking ({total}). Send the refund by hand to the payout details
          below, enter what you refunded, then mark it done — or decline. The rider is notified.
        </p>
      </div>
      <Tabs active="refunds" />
      <DataTable
        headers={['Rider', 'Route', 'Paid', 'Refund to', 'Reason', 'Cancelled', 'Action']}
        rows={rows.map((r) => [
          <span key="s" className="font-medium">{r.studentName ?? '—'}</span>,
          r.routeName,
          <span key="a" className="tnum font-semibold">{inr(r.amountCents)}</span>,
          <div key="p" className="min-w-0 text-sm">
            <p className="font-medium">{r.payoutMethod ?? '—'}</p>
            <p className="break-all font-mono text-xs text-muted-foreground">{r.payoutDetails ?? '—'}</p>
          </div>,
          <span key="rs" className="block max-w-xs text-sm text-muted-foreground">{r.reason ?? '—'}</span>,
          r.requestedAt ? formatDateTime(r.requestedAt) : '—',
          <form key="act" action={processRefundAction} className="flex flex-col gap-2">
            <input type="hidden" name="bookingId" value={r.bookingId} />
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-muted-foreground">₹</span>
              <input
                name="amount"
                inputMode="decimal"
                defaultValue={Math.round(r.amountCents / 100)}
                className="h-9 w-24 rounded-lg border border-input bg-transparent px-2 text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
              />
            </div>
            <input
              name="note"
              placeholder="Note / txn ref (optional)"
              className="h-9 w-44 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                name="approve"
                value="true"
                className="rounded-lg bg-success px-3 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              >
                Mark refunded
              </button>
              <button
                type="submit"
                name="approve"
                value="false"
                className="rounded-lg border border-destructive/40 px-3 py-1.5 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10"
              >
                No refund
              </button>
            </div>
          </form>,
        ])}
        empty="No refunds waiting to be processed."
      />
      <Pager page={page} totalPages={totalPages} basePath="/aevinite/payments/refunds" />
    </section>
  );
}
