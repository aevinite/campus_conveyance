import { createClient } from '@/lib/supabase/server';
import { listDeletedStudents } from '@/features/admin/repository';
import { restoreStudentAction, permanentlyDeleteStudentAction } from '@/features/admin/actions';
import { DataTable } from '@/components/data-table';
import { SubmitButton } from '@/components/submit-button';
import { ConfirmSubmit } from '@/components/confirm-submit';

export default async function AdminDeletedStudentsPage() {
  const db = await createClient();
  const students = await listDeletedStudents(db);
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Deleted Students</h1>
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
    </section>
  );
}
