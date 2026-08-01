import { redirect } from 'next/navigation';
import Link from 'next/link';
import { IndianRupee } from 'lucide-react';
import { listCompletedUpiPayments, OPS_PAGE_SIZE } from '@/features/admin/ops-repository';
import { DataTable } from '@/components/data-table';
import { Pager, pageParams } from '@/components/pager';
import { formatDateTime } from '@/lib/format-date';

export const dynamic = 'force-dynamic';

const inr = (cents: number) => `₹${Math.round((cents ?? 0) / 100).toLocaleString('en-IN')}`;

// Tab links shared with the "to verify" + refunds pages.
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

export default async function AdminPaymentHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, OPS_PAGE_SIZE);
  const { rows, total } = await listCompletedUpiPayments({ limit: OPS_PAGE_SIZE, offset });
  const totalPages = Math.max(1, Math.ceil(total / OPS_PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/aevinite/payments/history?page=${totalPages}`);

  return (
    <section className="space-y-4">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <IndianRupee className="size-3.5" />
          Payments
        </span>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Payment history</h1>
        <p className="text-muted-foreground">
          Every UPI payment you have processed ({total}) — who paid, how much, the UTR they submitted,
          and when it was verified or rejected.
        </p>
      </div>
      <Tabs active="history" />
      <DataTable
        headers={['Rider', 'Route', 'Amount', 'UTR', 'Ref', 'Status', 'Submitted', 'Verified', 'Note']}
        rows={rows.map((p) => [
          <div key="s" className="min-w-0">
            <p className="font-medium">{p.studentName ?? '—'}</p>
            {p.studentEmail && <p className="truncate text-xs text-muted-foreground">{p.studentEmail}</p>}
          </div>,
          p.routeName,
          <span key="a" className="tnum font-semibold">{inr(p.amountCents)}</span>,
          <span key="u" className="font-mono text-sm">{p.utr ?? '—'}</span>,
          <span key="r" className="font-mono text-xs text-muted-foreground">{p.reference ?? '—'}</span>,
          <span
            key="st"
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
              p.status === 'PAID'
                ? 'border-success/30 bg-success/10 text-success'
                : 'border-destructive/30 bg-destructive/10 text-destructive'
            }`}
          >
            {p.status === 'PAID' ? 'Verified' : 'Rejected'}
          </span>,
          p.submittedAt ? formatDateTime(p.submittedAt) : '—',
          p.verifiedAt ? formatDateTime(p.verifiedAt) : '—',
          <span key="n" className="text-sm text-muted-foreground">{p.note || '—'}</span>,
        ])}
        empty="No processed payments yet."
      />
      <Pager page={page} totalPages={totalPages} basePath="/aevinite/payments/history" />
    </section>
  );
}
