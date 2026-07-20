import { redirect } from 'next/navigation';
import { IdCard, Mail, Phone, User } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getMyAgency, listMyDriversPage, countMyDrivers } from '@/features/agency/repository';
import { restoreDriverAction, hardDeleteDriverAction } from '@/features/agency/actions';
import { SubmitButton } from '@/components/submit-button';
import { Pager, pageParams } from '@/components/pager';
import { ConfirmDeleteButton } from '../drivers/confirm-delete-button';

const PAGE_SIZE = 10;

export default async function AgencyDeletedDriversPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, PAGE_SIZE);
  const db = await createClient();
  const agency = await getMyAgency(db);
  const [deleted, total] = agency
    ? await Promise.all([
        listMyDriversPage(db, agency.id, { deleted: true, limit: PAGE_SIZE, offset }),
        countMyDrivers(db, agency.id, true),
      ])
    : [[], 0];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/agency/deleted-drivers?page=${totalPages}`);

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Deleted Drivers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Drivers you removed. Restore one to bring it back to Manage Drivers, or delete it permanently —
          permanent deletion also removes the driver&apos;s login account and cannot be undone.
        </p>
      </div>

      {deleted.length === 0 ? (
        <p className="rounded-lg border border-border bg-card/40 p-6 text-sm text-muted-foreground">
          No deleted drivers.
        </p>
      ) : (
        <div className="space-y-3">
          {deleted.map((d) => (
            <div
              key={d.driver_id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border bg-card/50 p-4"
            >
              <div className="flex min-w-0 gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                  <User className="size-5" />
                </span>
                <div className="min-w-0 space-y-0.5">
                  <span className="font-semibold">{d.name || '—'}</span>
                  <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Mail className="size-3.5" /> {d.email || '—'}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <Phone className="size-3.5" /> {d.phone || '—'}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <IdCard className="size-3.5" /> {d.license_no || 'No licence'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <form action={restoreDriverAction}>
                  <input type="hidden" name="driverId" value={d.driver_id} />
                  <SubmitButton size="sm" pendingText="Restoring…">
                    Restore
                  </SubmitButton>
                </form>
                <ConfirmDeleteButton
                  action={hardDeleteDriverAction}
                  driverId={d.driver_id}
                  trigger="Delete permanently"
                  title="Permanently delete this driver?"
                  message={`${d.name || 'This driver'} and their login account will be removed for good. This cannot be undone.`}
                  confirmLabel="Delete permanently"
                  pendingText="Deleting…"
                />
              </div>
            </div>
          ))}
          <Pager page={page} totalPages={totalPages} basePath="/agency/deleted-drivers" />
        </div>
      )}
    </section>
  );
}
