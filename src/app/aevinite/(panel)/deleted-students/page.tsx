import { redirect } from 'next/navigation';
import { UserMinus } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { listDeletedStudents, ADMIN_PAGE_SIZE } from '@/features/admin/repository';
import { restoreStudentAction, permanentlyDeleteStudentAction } from '@/features/admin/actions';
import { DataTable } from '@/components/data-table';
import { SubmitButton } from '@/components/submit-button';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { Pager, pageParams } from '@/components/pager';

export default async function AdminDeletedStudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, ADMIN_PAGE_SIZE);
  const db = await createClient();
  const { rows: students, total } = await listDeletedStudents(db, { limit: ADMIN_PAGE_SIZE, offset });
  const totalPages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  // Don't strand the admin on an out-of-range page (e.g. after restoring the last
  // item on the final page).
  if (total > 0 && page > totalPages) redirect(`/aevinite/deleted-students?page=${totalPages}`);
  return (
    <section className="space-y-4">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <UserMinus className="size-3.5" />
          Recovery
        </span>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Deleted Students</h1>
        <p className="text-muted-foreground">Restore a student, or remove them for good.</p>
      </div>
      <DataTable
        headers={['Name', 'Email', 'Phone', 'Action']}
        rows={students.map((s) => [
          s.full_name ?? '—',
          s.email ?? '—',
          s.phone ?? '—',
          <div className="flex flex-wrap gap-2" key={s.id}>
            <form action={restoreStudentAction}>
              <input type="hidden" name="studentId" value={s.id} />
              <SubmitButton size="sm" pendingText="Restoring…">
                Restore
              </SubmitButton>
            </form>
            <ConfirmSubmit
              action={permanentlyDeleteStudentAction}
              fields={{ studentId: s.id }}
              triggerLabel="Delete permanently"
              title="Permanently delete this student?"
              description={`“${s.full_name ?? s.email ?? 'This student'}” and their login will be permanently removed, freeing their email for reuse. This cannot be undone.`}
              confirmLabel="Delete permanently"
              pendingText="Deleting…"
            />
          </div>,
        ])}
        empty="No deleted students."
      />
      <Pager page={page} totalPages={totalPages} basePath="/aevinite/deleted-students" />
    </section>
  );
}
