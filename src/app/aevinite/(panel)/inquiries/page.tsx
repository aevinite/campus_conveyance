import { redirect } from 'next/navigation';
import { Mail } from 'lucide-react';
import { listContactMessages, OPS_PAGE_SIZE } from '@/features/admin/ops-repository';
import { setContactStatusAction } from '@/features/admin/ops-actions';
import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { Pager, pageParams } from '@/components/pager';
import { buttonVariants } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format-date';

export const dynamic = 'force-dynamic';

export default async function AdminInquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, OPS_PAGE_SIZE);
  const { rows, total } = await listContactMessages({ limit: OPS_PAGE_SIZE, offset });
  const totalPages = Math.max(1, Math.ceil(total / OPS_PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/aevinite/inquiries?page=${totalPages}`);

  return (
    <section className="space-y-4">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <Mail className="size-3.5" />
          Inquiries
        </span>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Contact Inquiries</h1>
        <p className="text-muted-foreground">Messages sent from the landing-page contact form ({total}).</p>
      </div>
      <DataTable
        headers={['From', 'Organization', 'Message', 'Status', 'Received', 'Action']}
        rows={rows.map((m) => {
          const handled = m.status === 'HANDLED';
          return [
            <div key="f" className="min-w-0">
              <p className="font-medium">{m.name ?? '—'}</p>
              <p className="text-xs text-muted-foreground">{m.email ?? '—'}</p>
              {m.phone && <p className="text-xs text-muted-foreground">{m.phone}</p>}
            </div>,
            m.organization ?? '—',
            <span key="msg" className="block max-w-md text-sm text-muted-foreground">{m.message}</span>,
            <StatusBadge key="s" value={m.status} />,
            formatDateTime(m.created_at),
            <form key="a" action={setContactStatusAction}>
              <input type="hidden" name="id" value={m.id} />
              <input type="hidden" name="status" value={handled ? 'NEW' : 'HANDLED'} />
              <button type="submit" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
                {handled ? 'Reopen' : 'Mark handled'}
              </button>
            </form>,
          ];
        })}
        empty="No contact inquiries yet."
      />
      <Pager page={page} totalPages={totalPages} basePath="/aevinite/inquiries" />
    </section>
  );
}
