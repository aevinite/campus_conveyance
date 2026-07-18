import { createClient } from '@/lib/supabase/server';
import { getMyAgency, listMyStudents } from '@/features/agency/repository';
import { restoreStudentAction } from '@/features/agency/actions';
import { DataTable } from '@/components/data-table';
import { SubmitButton } from '@/components/submit-button';

export default async function AgencyDeletedStudentsPage() {
  const db = await createClient();
  const agency = await getMyAgency(db);
  const students = agency ? await listMyStudents(db, agency.id) : [];
  const hidden = students.filter((s) => s.hidden);

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Deleted Students</h1>
      <DataTable
        headers={['Name', 'Email', 'Phone', 'Action']}
        rows={hidden.map((s) => [
          s.name ?? '—',
          s.email ?? '—',
          s.phone ?? '—',
          <form action={restoreStudentAction} key={s.student_id}>
            <input type="hidden" name="studentId" value={s.student_id} />
            <SubmitButton size="sm" pendingText="Restoring…">
              Restore
            </SubmitButton>
          </form>,
        ])}
        empty="No deleted students."
      />
    </section>
  );
}
