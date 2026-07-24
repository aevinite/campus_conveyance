import { redirect } from 'next/navigation';
import { Bell } from 'lucide-react';
import { listNotifications, OPS_PAGE_SIZE } from '@/features/admin/ops-repository';
import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { Pager, pageParams } from '@/components/pager';
import { formatDateTime } from '@/lib/format-date';

export const dynamic = 'force-dynamic';

export default async function AdminNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, OPS_PAGE_SIZE);
  const { rows, total } = await listNotifications({ limit: OPS_PAGE_SIZE, offset });
  const totalPages = Math.max(1, Math.ceil(total / OPS_PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/aevinite/notifications?page=${totalPages}`);

  return (
    <section className="space-y-4">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <Bell className="size-3.5" />
          Notifications
        </span>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">System Notifications</h1>
        <p className="text-muted-foreground">Every in-app message sent to students, parents and drivers ({total}).</p>
      </div>
      <DataTable
        headers={['Recipient', 'Title', 'Message', 'Read', 'Sent']}
        rows={rows.map((n) => [
          n.recipientName ?? '—',
          <span key="t" className="font-medium">{n.title}</span>,
          <span key="b" className="text-sm text-muted-foreground">{n.body ?? '—'}</span>,
          <StatusBadge key="r" value={n.is_read ? 'Read' : 'Unread'} tone={n.is_read ? 'green' : 'amber'} />,
          formatDateTime(n.created_at),
        ])}
        empty="No notifications sent yet."
      />
      <Pager page={page} totalPages={totalPages} basePath="/aevinite/notifications" />
    </section>
  );
}
