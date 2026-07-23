import { redirect } from 'next/navigation';
import { Building } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { listDeletedAgencies, ADMIN_PAGE_SIZE } from '@/features/admin/repository';
import { restoreAgencyAction, permanentlyDeleteAgencyAction } from '@/features/admin/actions';
import { DataTable } from '@/components/data-table';
import { SubmitButton } from '@/components/submit-button';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { Pager, pageParams } from '@/components/pager';

export default async function AdminDeletedProvidersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, ADMIN_PAGE_SIZE);
  const db = await createClient();
  const { rows: agencies, total } = await listDeletedAgencies(db, { limit: ADMIN_PAGE_SIZE, offset });
  const totalPages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/aevinite/deleted-providers?page=${totalPages}`);
  return (
    <section className="space-y-4">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <Building className="size-3.5" />
          Recovery
        </span>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Deleted Service Providers</h1>
        <p className="text-muted-foreground">Restore a provider, or remove it for good.</p>
      </div>
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
      <Pager page={page} totalPages={totalPages} basePath="/aevinite/deleted-providers" />
    </section>
  );
}
