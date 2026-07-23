import { redirect } from 'next/navigation';
import { History } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { listAuditLogs, ADMIN_PAGE_SIZE } from '@/features/admin/repository';
import { DataTable } from '@/components/data-table';
import { Pager, pageParams } from '@/components/pager';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format-date';

// Human-readable label + tone for each logged action code.
const ACTIONS: Record<string, { label: string; tone: 'good' | 'bad' | 'warn' | 'muted' }> = {
  AGENCY_APPROVED: { label: 'Approved provider', tone: 'good' },
  AGENCY_REJECTED: { label: 'Rejected provider', tone: 'bad' },
  AGENCY_UPDATED: { label: 'Edited provider', tone: 'muted' },
  AGENCY_DELETED: { label: 'Deleted provider', tone: 'warn' },
  AGENCY_RESTORED: { label: 'Restored provider', tone: 'good' },
  AGENCY_PURGED: { label: 'Purged provider', tone: 'bad' },
  SERVICE_REQUEST_APPROVED: { label: 'Approved service area', tone: 'good' },
  SERVICE_REQUEST_REJECTED: { label: 'Rejected service area', tone: 'bad' },
  STUDENT_DELETED: { label: 'Deleted student', tone: 'warn' },
  STUDENT_RESTORED: { label: 'Restored student', tone: 'good' },
  STUDENT_PURGED: { label: 'Purged student', tone: 'bad' },
  COLLEGE_ADDED: { label: 'Added college', tone: 'good' },
  COLLEGE_UPDATED: { label: 'Updated college', tone: 'muted' },
  COLLEGE_DELETED: { label: 'Deleted college', tone: 'warn' },
  COLLEGE_RESTORED: { label: 'Restored college', tone: 'good' },
  COLLEGE_PURGED: { label: 'Purged college', tone: 'bad' },
  COLLEGE_ENABLED: { label: 'Enabled college', tone: 'good' },
  COLLEGE_DISABLED: { label: 'Disabled college', tone: 'warn' },
  MAINTENANCE_ON: { label: 'Maintenance ON', tone: 'warn' },
  MAINTENANCE_OFF: { label: 'Maintenance OFF', tone: 'good' },
};

const TONE: Record<'good' | 'bad' | 'warn' | 'muted', string> = {
  good: 'bg-[color:var(--success)]/12 text-success',
  bad: 'bg-destructive/12 text-destructive',
  warn: 'bg-[color:var(--warning)]/15 text-warning',
  muted: 'bg-muted text-muted-foreground',
};

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, ADMIN_PAGE_SIZE);
  const db = await createClient();
  const { rows: logs, total } = await listAuditLogs(db, { limit: ADMIN_PAGE_SIZE, offset });
  const totalPages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/aevinite/audit?page=${totalPages}`);

  return (
    <section className="space-y-4">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <History className="size-3.5" />
          Audit trail
        </span>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Activity Log</h1>
        <p className="text-muted-foreground">
          A record of admin approvals, rejections, deletes and restores. Most recent first.
        </p>
      </div>
      <DataTable
        headers={['Action', 'Target', 'Details', 'By', 'When']}
        rows={logs.map((l) => {
          const meta = ACTIONS[l.action] ?? { label: l.action, tone: 'muted' as const };
          // Target = the affected entity's NAME (colleges/providers/service
          // requests log one), falling back to a short id, then the entity type.
          const target =
            (l.metadata.name as string) ||
            (l.entity_id ? l.entity_id.slice(0, 8) : '') ||
            (l.entity ?? '—');
          // Details carries the reason (if any), else the entity type for context.
          const detail = l.metadata.reason ? `Reason: ${l.metadata.reason as string}` : (l.entity ?? '—');
          return [
            <span
              key="a"
              className={cn('inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold', TONE[meta.tone])}
            >
              {meta.label}
            </span>,
            target,
            <span key="d" className="text-muted-foreground">
              {detail}
            </span>,
            l.actorName || l.actorEmail || '—',
            formatDateTime(l.created_at),
          ];
        })}
        empty="No admin activity recorded yet."
      />
      <Pager page={page} totalPages={totalPages} basePath="/aevinite/audit" />
    </section>
  );
}
