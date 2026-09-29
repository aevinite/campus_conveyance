import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { listStudents, listManagedChildren, ADMIN_PAGE_SIZE } from '@/features/admin/repository';
import { deleteStudentAction } from '@/features/admin/actions';
import { DataTable } from '@/components/data-table';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { Pager, pageParams } from '@/components/pager';

export default async function AdminStudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; mpage?: string }>;
}) {
  const { page: pageParam, mpage: mpageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, ADMIN_PAGE_SIZE);
  const { page: mpage, offset: moffset } = pageParams(mpageParam, ADMIN_PAGE_SIZE);
  const db = await createClient();
  const [{ rows: students, total }, { rows: managed, total: managedTotal }] = await Promise.all([
    listStudents(db, { limit: ADMIN_PAGE_SIZE, offset }),
    listManagedChildren({ limit: ADMIN_PAGE_SIZE, offset: moffset }),
  ]);
  const managedPages = Math.max(1, Math.ceil(managedTotal / ADMIN_PAGE_SIZE));
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
        headers={['Name', 'Email', 'Phone', 'Details', 'Action']}
        rows={students.map((s) => [
          s.full_name ?? '—',
          s.email ?? '—',
          s.phone ?? '—',
          <Link key="v" href={`/aevinite/students/${s.id}`} className="text-primary transition-colors hover:text-primary/70">
            View →
          </Link>,
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

      <div className="pt-4">
        <h2 className="text-lg font-semibold">
          Parent-managed children{managedTotal > 0 && ` (${managedTotal})`}
        </h2>
        <p className="text-sm text-muted-foreground">
          Children a parent added without their own login. They&apos;re managed from the parent&apos;s account.
        </p>
      </div>
      <DataTable
        headers={['Name', 'Email', 'Phone', 'Campus', 'Parent']}
        rows={managed.map((c) => [
          c.full_name ?? '—',
          c.email ?? '—',
          c.phone ?? '—',
          c.campus ?? '—',
          c.parents ?? '—',
        ])}
        empty="No parent-managed children."
      />
      {managedPages > 1 && (
        <Pager page={mpage} totalPages={managedPages} basePath="/aevinite/students" param="mpage" />
      )}
    </section>
  );
}
