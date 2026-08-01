import { redirect } from 'next/navigation';
import Link from 'next/link';
import { IndianRupee } from 'lucide-react';
import { listPendingUpiPayments, OPS_PAGE_SIZE } from '@/features/admin/ops-repository';
import { verifyUpiPaymentAction } from '@/features/admin/ops-actions';
import { DataTable } from '@/components/data-table';
import { Pager, pageParams } from '@/components/pager';
import { formatDateTime } from '@/lib/format-date';

export const dynamic = 'force-dynamic';

const inr = (cents: number) => `₹${Math.round((cents ?? 0) / 100).toLocaleString('en-IN')}`;

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, OPS_PAGE_SIZE);
  const { rows, total } = await listPendingUpiPayments({ limit: OPS_PAGE_SIZE, offset });
  const totalPages = Math.max(1, Math.ceil(total / OPS_PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/aevinite/payments?page=${totalPages}`);

  return (
    <section className="space-y-4">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <IndianRupee className="size-3.5" />
          Payments
        </span>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">UPI payments to verify</h1>
        <p className="text-muted-foreground">
          Riders who paid by UPI and submitted a reference ({total}). Check the money arrived in your
          UPI account, then approve to confirm the seat.
        </p>
      </div>
      <div className="inline-flex rounded-xl border border-border bg-card p-1">
        <Link href="/aevinite/payments" className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground">
          To verify
        </Link>
        <Link href="/aevinite/payments/refunds" className="rounded-lg px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
          Refunds
        </Link>
        <Link href="/aevinite/payments/history" className="rounded-lg px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
          Completed
        </Link>
      </div>
      <DataTable
        headers={['Rider', 'Route', 'Amount', 'UTR', 'Ref', 'Submitted', 'Action']}
        rows={rows.map((p) => [
          <span key="s" className="font-medium">{p.studentName ?? '—'}</span>,
          p.routeName,
          <span key="a" className="tnum font-semibold">{inr(p.amountCents)}</span>,
          <span key="u" className="font-mono text-sm">{p.utr ?? '—'}</span>,
          <span key="r" className="font-mono text-xs text-muted-foreground">{p.reference ?? '—'}</span>,
          p.submittedAt ? formatDateTime(p.submittedAt) : '—',
          <form key="act" action={verifyUpiPaymentAction} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input type="hidden" name="bookingId" value={p.bookingId} />
            <input
              name="note"
              placeholder="Note (optional)"
              className="h-9 w-40 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                name="approve"
                value="true"
                className="rounded-lg bg-success px-3 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              >
                Approve
              </button>
              <button
                type="submit"
                name="approve"
                value="false"
                className="rounded-lg border border-destructive/40 px-3 py-1.5 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10"
              >
                Reject
              </button>
            </div>
          </form>,
        ])}
        empty="No UPI payments waiting for verification."
      />
      <Pager page={page} totalPages={totalPages} basePath="/aevinite/payments" />
    </section>
  );
}
