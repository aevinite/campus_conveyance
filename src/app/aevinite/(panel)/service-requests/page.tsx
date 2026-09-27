import { redirect } from 'next/navigation';
import { ClipboardList } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import {
  listActionableServiceRequests,
  listServiceRequests,
  countServiceRequests,
  type ServiceRequest,
} from '@/features/admin/repository';
import {
  approveServiceRequestAction,
  rejectServiceRequestAction,
} from '@/features/admin/actions';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/status-badge';
import { SubmitButton } from '@/components/submit-button';
import { Input } from '@/components/ui/input';
import { Pager, pageParams } from '@/components/pager';
import { serviceRequestStage, STAGE_LABEL, STAGE_TONE } from '@/lib/service-request-stage';

const PAGE_SIZE = 15;

export default async function AdminServiceRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, PAGE_SIZE);
  const db = await createClient();
  const [actionable, pipeline, total] = await Promise.all([
    listActionableServiceRequests(db),
    listServiceRequests(db, { limit: PAGE_SIZE, offset }),
    countServiceRequests(db),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/aevinite/service-requests?page=${totalPages}`);

  return (
    <section className="space-y-6">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <ClipboardList className="size-3.5" />
          Service areas
        </span>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Service Area Requests</h1>
        <p className="text-muted-foreground">
          A request reaches you only after the school/college accepts it. Approving here creates the
          live service that students can book.
        </p>
      </div>

      {/* Needs your approval — campus-accepted, awaiting final admin approval. */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">
          Needs your approval{actionable.length > 0 && ` (${actionable.length})`}
        </h2>
        {actionable.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-12 text-center">
            <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
              <ClipboardList className="size-6" />
            </span>
            <p className="font-medium">Nothing awaiting your approval</p>
            <p className="text-sm text-muted-foreground">
              Requests appear here once a school/college accepts them.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {actionable.map((r) => (
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
                        Approve &amp; go live
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
          </div>
        )}
      </div>

      {/* Whole pipeline — read-only visibility of every other request. */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Pipeline</h2>
        {pipeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">No other requests yet.</p>
        ) : (
          <>
            <div className="divide-y divide-border rounded-2xl border border-border bg-card">
              {pipeline.map((r) => (
                <PipelineRow key={r.id} r={r} />
              ))}
            </div>
            <Pager page={page} totalPages={totalPages} basePath="/aevinite/service-requests" />
          </>
        )}
      </div>
    </section>
  );
}

function PipelineRow({ r }: { r: ServiceRequest }) {
  const stage = serviceRequestStage(r.status, r.campusStatus);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {r.agencyName} · {r.institutionName}{' '}
          <span className="text-muted-foreground">
            ({r.name} · {r.vehicle_type === 'VAN' ? 'Van' : 'Bus'})
          </span>
        </p>
      </div>
      <StatusBadge value={STAGE_LABEL[stage]} tone={STAGE_TONE[stage]} />
    </div>
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
