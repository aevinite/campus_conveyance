import { redirect } from 'next/navigation';
import { UsersRound } from 'lucide-react';
import { listParents, listActiveLinkCodes, OPS_PAGE_SIZE } from '@/features/admin/ops-repository';
import { DataTable } from '@/components/data-table';
import { Pager, pageParams } from '@/components/pager';
import { formatDateTime } from '@/lib/format-date';

export const dynamic = 'force-dynamic';

export default async function AdminParentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, OPS_PAGE_SIZE);
  const [{ rows, total }, codes] = await Promise.all([
    listParents({ limit: OPS_PAGE_SIZE, offset }),
    listActiveLinkCodes(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / OPS_PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/aevinite/parents?page=${totalPages}`);

  return (
    <section className="space-y-6">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <UsersRound className="size-3.5" />
          Parents
        </span>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Parents &amp; Linked Children</h1>
        <p className="text-muted-foreground">Parent accounts ({total}) and the students they are linked to.</p>
      </div>

      <DataTable
        headers={['Parent', 'Email', 'Phone', 'Linked children']}
        rows={rows.map((p) => [
          <span key="n" className="font-medium">{p.name ?? '—'}</span>,
          p.email ?? '—',
          p.phone ?? '—',
          p.children.length ? (
            <div key="c" className="flex flex-wrap gap-1.5">
              {p.children.map((c, i) => (
                <span key={i} className="rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-xs">{c}</span>
              ))}
            </div>
          ) : (
            <span key="c" className="text-muted-foreground">None</span>
          ),
        ])}
        empty="No parent accounts yet."
      />
      <Pager page={page} totalPages={totalPages} basePath="/aevinite/parents" />

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Active link codes ({codes.length})</h2>
        <p className="text-sm text-muted-foreground">
          One-time codes a student generated so a parent can link to them. They expire shortly after issue.
        </p>
        <DataTable
          headers={['Code', 'Student', 'Expires']}
          rows={codes.map((c) => [
            <span key="code" className="font-mono font-semibold tracking-widest">{c.code}</span>,
            c.studentName ?? '—',
            formatDateTime(c.expires_at),
          ])}
          empty="No active link codes right now."
        />
      </div>
    </section>
  );
}
