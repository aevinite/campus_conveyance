import { createClient } from '@/lib/supabase/server';
import { listStudents } from '@/features/admin/repository';
import { deleteStudentAction } from '@/features/admin/actions';
import { DataTable } from '@/components/data-table';
import { ConfirmSubmit } from '@/components/confirm-submit';

export default async function AdminStudentsPage() {
  const db = await createClient();
  const students = await listStudents(db);
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Manage Students</h1>
      <DataTable
        headers={['Name', 'Email', 'Phone', 'Action']}
        rows={students.map((s) => [
          s.full_name ?? '—',
          s.email ?? '—',
          s.phone ?? '—',
          <ConfirmSubmit
            key={s.id}
            action={deleteStudentAction}
            fields={{ studentId: s.id }}
            triggerLabel="Delete"
            title="Delete this student?"
            description={`“${s.full_name ?? s.email ?? 'This student'}” will be moved to Deleted Students. You can restore them from there.`}
            confirmLabel="Delete"
            pendingText="Deleting…"
          />,
        ])}
        empty="No students."
      />
    </section>
  );
}
