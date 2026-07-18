import { createClient } from '@/lib/supabase/server';
import { listDeletedAgencies } from '@/features/admin/repository';
import { restoreAgencyAction, permanentlyDeleteAgencyAction } from '@/features/admin/actions';
import { DataTable } from '@/components/data-table';
import { SubmitButton } from '@/components/submit-button';
import { ConfirmSubmit } from '@/components/confirm-submit';

export default async function AdminDeletedProvidersPage() {
  const db = await createClient();
  const agencies = await listDeletedAgencies(db);
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Deleted Service Providers</h1>
      <DataTable
        headers={['Company', 'Email', 'Phone', 'Action']}
        rows={agencies.map((a) => [
          a.name,
          a.email ?? '—',
          a.phone ?? '—',
          <div className="flex flex-wrap gap-2" key={a.id}>
            <form action={restoreAgencyAction}>
              <input type="hidden" name="agencyId" value={a.id} />
              <SubmitButton size="sm" pendingText="Restoring…">
                Restore
              </SubmitButton>
            </form>
            <ConfirmSubmit
              action={permanentlyDeleteAgencyAction}
              fields={{ agencyId: a.id }}
              triggerLabel="Delete permanently"
              title="Permanently delete this service provider?"
              description={`“${a.name}”, its login, services and requests will be permanently removed from the database. This cannot be undone.`}
              confirmLabel="Delete permanently"
              pendingText="Deleting…"
            />
          </div>,
        ])}
        empty="No deleted service providers."
      />
    </section>
  );
}
