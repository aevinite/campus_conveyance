import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import {
  getMyAgency,
  listAgencyCompletedPayments,
  countAgencyCompletedPayments,
} from '@/features/agency/repository';
import { DataTable } from '@/components/data-table';
import { Pager, pageParams } from '@/components/pager';
import { formatDateTime } from '@/lib/format-date';

const PAGE_SIZE = 20;

const inr = (cents: number) => `₹${Math.round((cents ?? 0) / 100).toLocaleString('en-IN')}`;

export default async function AgencyPaymentsPage({
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
        listAgencyCompletedPayments(db, agency.id, { limit: PAGE_SIZE, offset }),
        countAgencyCompletedPayments(db, agency.id),
      ])
    : [[], 0];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/agency/payments?page=${totalPages}`);

  return (
    <section className="space-y-4">
      <div>
        <span className="text-xs font-semibold uppercase tracking-widest text-primary">Payments</span>
        <h1 className="mt-1 text-2xl font-heading font-bold tracking-tight sm:text-3xl">
          Completed payments
        </h1>
        <p className="text-muted-foreground">
          Students who have fully paid for a ride on your routes ({total}) — the confirmed amount and
          when it was paid.
        </p>
      </div>
      <DataTable
        headers={['Rider', 'Route', 'Amount', 'UTR', 'Paid on']}
        rows={rows.map((p) => [
          <div key="s" className="min-w-0">
            <p className="font-medium">{p.studentName ?? '—'}</p>
            {p.studentEmail && <p className="truncate text-xs text-muted-foreground">{p.studentEmail}</p>}
          </div>,
          p.routeName,
          <span key="a" className="tnum font-semibold">{inr(p.amountCents)}</span>,
          <span key="u" className="font-mono text-sm">{p.utr ?? '—'}</span>,
          p.verifiedAt ? formatDateTime(p.verifiedAt) : p.submittedAt ? formatDateTime(p.submittedAt) : '—',
        ])}
        empty="No completed payments yet."
      />
      <Pager page={page} totalPages={totalPages} basePath="/agency/payments" />
    </section>
  );
}
