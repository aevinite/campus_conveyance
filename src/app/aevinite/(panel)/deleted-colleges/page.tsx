import { redirect } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { listDeletedColleges, ADMIN_PAGE_SIZE } from '@/features/admin/repository';
import { restoreCollegeAction, permanentlyDeleteCollegeAction } from '@/features/admin/actions';
import { DataTable } from '@/components/data-table';
import { SubmitButton } from '@/components/submit-button';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { Pager, pageParams } from '@/components/pager';

export default async function AdminDeletedCollegesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, ADMIN_PAGE_SIZE);
  const db = await createClient();
  const { rows: colleges, total } = await listDeletedColleges(db, { limit: ADMIN_PAGE_SIZE, offset });
  const totalPages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/aevinite/deleted-colleges?page=${totalPages}`);
  return (
    <section className="space-y-4">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <Trash2 className="size-3.5" />
          Recovery
        </span>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Deleted Colleges</h1>
        <p className="text-muted-foreground">Restore a college, or remove it for good.</p>
      </div>
      <DataTable
        headers={['Name', 'Type', 'City', 'Action']}
        rows={colleges.map((c) => [
          c.name,
          c.kind === 'COLLEGE' ? 'College / University' : 'School',
          c.city ?? '—',
          <div className="flex flex-wrap gap-2" key={c.id}>
            <form action={restoreCollegeAction}>
              <input type="hidden" name="id" value={c.id} />
              <SubmitButton size="sm" pendingText="Restoring…">
                Restore
              </SubmitButton>
            </form>
            <ConfirmSubmit
              action={permanentlyDeleteCollegeAction}
              fields={{ id: c.id }}
              triggerLabel="Delete permanently"
              title="Permanently delete this college?"
              description={`“${c.name}” and everything tied to it — routes, stops, agency service listings, and student bookings for this college — will be permanently erased. This cannot be undone.`}
              confirmLabel="Delete permanently"
              pendingText="Deleting…"
            />
          </div>,
        ])}
        empty="No deleted colleges."
      />
      <Pager page={page} totalPages={totalPages} basePath="/aevinite/deleted-colleges" />
    </section>
  );
}
