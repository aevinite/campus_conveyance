import { ClipboardList } from 'lucide-react';
import {
  resolveInstitutionId,
  listServiceRequestsForInstitution,
} from '@/features/institution/repository';
import {
  approveCampusServiceRequestAction,
  rejectCampusServiceRequestAction,
} from '@/features/institution/actions';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/status-badge';
import { SubmitButton } from '@/components/submit-button';
import { Input } from '@/components/ui/input';
import { formatDateTime } from '@/lib/format-date';

export const dynamic = 'force-dynamic';

export default async function InstitutionRequestsPage() {
  const institutionId = await resolveInstitutionId();
  const requests = institutionId ? await listServiceRequestsForInstitution(institutionId) : [];
  const pending = requests.filter((r) => r.status === 'PENDING');
  const decided = requests.filter((r) => r.status !== 'PENDING');

  return (
    <section className="space-y-5">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <ClipboardList className="size-3.5" />
          Governance
        </span>
        <h1 className="mt-1 text-2xl font-heading font-bold tracking-tight sm:text-3xl">Agency requests</h1>
        <p className="text-muted-foreground">
          Agencies asking to serve your campus. Approving adds them as a live provider under Agencies.
        </p>
      </div>

      {pending.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-14 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
            <ClipboardList className="size-6" />
          </span>
          <p className="font-medium">No pending requests</p>
          <p className="text-sm text-muted-foreground">New requests to serve your campus will show up here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pending.map((r) => (
            <Card key={r.id} className="rounded-2xl">
              <CardContent className="space-y-4 py-5">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Detail label="Agency" value={r.agencyName} />
                  <Detail label="Service" value={r.name} />
                  <Detail label="Vehicle type" value={r.vehicleType === 'VAN' ? 'Van' : 'Bus'} />
                  <Detail label="Requested" value={r.created_at ? formatDateTime(r.created_at) : '—'} />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Description</p>
                  <p className="text-sm">{r.description || '—'}</p>
                </div>
                <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
                  <form action={approveCampusServiceRequestAction}>
                    <input type="hidden" name="requestId" value={r.id} />
                    <SubmitButton size="sm" pendingText="Approving…">
                      Approve
                    </SubmitButton>
                  </form>
                  <form action={rejectCampusServiceRequestAction} className="flex items-end gap-2">
                    <input type="hidden" name="requestId" value={r.id} />
                    <Input name="reason" placeholder="Reason (optional)" className="h-7 w-48 text-xs" />
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

      {decided.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Reviewed</h2>
          <div className="divide-y divide-border rounded-2xl border border-border bg-card">
            {decided.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {r.agencyName} · {r.name}{' '}
                    <span className="text-muted-foreground">({r.vehicleType === 'VAN' ? 'Van' : 'Bus'})</span>
                  </p>
                  {r.status === 'REJECTED' && r.rejectedReason && (
                    <p className="text-xs text-muted-foreground">Reason: {r.rejectedReason}</p>
                  )}
                </div>
                <StatusBadge value={r.status} />
              </div>
            ))}
          </div>
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
