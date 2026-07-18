import { createClient } from '@/lib/supabase/server';
import { listDeletedColleges } from '@/features/admin/repository';
import { restoreCollegeAction, permanentlyDeleteCollegeAction } from '@/features/admin/actions';
import { DataTable } from '@/components/data-table';
import { SubmitButton } from '@/components/submit-button';
import { ConfirmSubmit } from '@/components/confirm-submit';

export default async function AdminDeletedCollegesPage() {
  const db = await createClient();
  const colleges = await listDeletedColleges(db);
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Deleted Colleges</h1>
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
    </section>
  );
}
