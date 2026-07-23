import { redirect } from 'next/navigation';
import { Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { listStudents, ADMIN_PAGE_SIZE } from '@/features/admin/repository';
import { deleteStudentAction } from '@/features/admin/actions';
import { DataTable } from '@/components/data-table';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { Pager, pageParams } from '@/components/pager';

export default async function AdminStudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, ADMIN_PAGE_SIZE);
  const db = await createClient();
  const { rows: students, total } = await listStudents(db, { limit: ADMIN_PAGE_SIZE, offset });
  const totalPages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/aevinite/students?page=${totalPages}`);
  return (
    <section className="space-y-4">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <Users className="size-3.5" />
          Students
        </span>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Manage Students</h1>
      </div>
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
      <Pager page={page} totalPages={totalPages} basePath="/aevinite/students" />
    </section>
  );
}
