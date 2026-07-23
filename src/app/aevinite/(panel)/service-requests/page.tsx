import { redirect } from 'next/navigation';
import { ClipboardList } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { listServiceRequests, countServiceRequests } from '@/features/admin/repository';
import {
  approveServiceRequestAction,
  rejectServiceRequestAction,
} from '@/features/admin/actions';
import { Card, CardContent } from '@/components/ui/card';
import { SubmitButton } from '@/components/submit-button';
import { Input } from '@/components/ui/input';
import { Pager, pageParams } from '@/components/pager';

const PAGE_SIZE = 15;

export default async function AdminServiceRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, PAGE_SIZE);
  const db = await createClient();
  const [requests, total] = await Promise.all([
    listServiceRequests(db, { limit: PAGE_SIZE, offset }),
    countServiceRequests(db),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/aevinite/service-requests?page=${totalPages}`);

  return (
    <section className="space-y-4">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <ClipboardList className="size-3.5" />
          Service areas
        </span>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Service Area Requests</h1>
        <p className="text-muted-foreground">
          Providers asking to serve a new college/school. Approving creates the live service.
        </p>
      </div>

      {requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-16 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
            <ClipboardList className="size-6" />
          </span>
          <p className="font-medium">No pending service requests</p>
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((r) => (
            <Card key={r.id} className="rounded-2xl">
              <CardContent className="space-y-4 py-5">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Detail label="Provider" value={r.agencyName} />
                  <Detail label="School / College" value={r.institutionName} />
                  <Detail label="Service" value={r.name} />
                  <Detail label="Vehicle type" value={r.vehicle_type === 'VAN' ? 'Van' : 'Bus'} />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Description</p>
                  <p className="text-sm">{r.description || '—'}</p>
                </div>
                <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
                  <form action={approveServiceRequestAction}>
                    <input type="hidden" name="requestId" value={r.id} />
                    <SubmitButton size="sm" pendingText="Approving…">
                      Approve
                    </SubmitButton>
                  </form>
                  <form action={rejectServiceRequestAction} className="flex items-end gap-2">
                    <input type="hidden" name="requestId" value={r.id} />
                    <Input
                      name="reason"
                      placeholder="Reason (optional)"
                      className="h-7 w-48 text-xs"
                    />
                    <SubmitButton size="sm" variant="destructive" pendingText="Rejecting…">
                      Reject
                    </SubmitButton>
                  </form>
                </div>
              </CardContent>
            </Card>
          ))}
          <Pager page={page} totalPages={totalPages} basePath="/aevinite/service-requests" />
        </div>
      )}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm">{value || '—'}</p>
    </div>
  );
}
