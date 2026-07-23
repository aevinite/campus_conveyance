import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMyAgency, listHiddenStudents, countHiddenStudents } from '@/features/agency/repository';
import { restoreStudentAction } from '@/features/agency/actions';
import { DataTable } from '@/components/data-table';
import { SubmitButton } from '@/components/submit-button';
import { Pager, pageParams } from '@/components/pager';

const PAGE_SIZE = 20;

export default async function AgencyDeletedStudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, PAGE_SIZE);
  const db = await createClient();
  const agency = await getMyAgency(db);
  // Paginate the removed students in the DB (migration 0060) rather than loading
  // every student who ever booked and filtering hidden in JS.
  const [hidden, total] = agency
    ? await Promise.all([
        listHiddenStudents(db, agency.id, { limit: PAGE_SIZE, offset }),
        countHiddenStudents(db, agency.id),
      ])
    : [[], 0];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/agency/deleted-students?page=${totalPages}`);

  return (
    <section className="space-y-4">
      <div>
        <span className="text-xs font-semibold uppercase tracking-widest text-primary">Students</span>
        <h1 className="mt-1 text-2xl font-heading font-bold tracking-tight sm:text-3xl">Deleted students</h1>
      </div>
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
      <Pager page={page} totalPages={totalPages} basePath="/agency/deleted-students" />
    </section>
  );
}
