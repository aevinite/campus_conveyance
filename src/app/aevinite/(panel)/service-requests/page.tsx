import { createClient } from '@/lib/supabase/server';
import { listServiceRequests } from '@/features/admin/repository';
import {
  approveServiceRequestAction,
  rejectServiceRequestAction,
} from '@/features/admin/actions';
import { Card, CardContent } from '@/components/ui/card';
import { SubmitButton } from '@/components/submit-button';
import { Input } from '@/components/ui/input';

export default async function AdminServiceRequestsPage() {
  const db = await createClient();
  const requests = await listServiceRequests(db);

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Service Area Requests</h1>
        <p className="text-muted-foreground">
          Providers asking to serve a new college/school. Approving creates the live service.
        </p>
      </div>

      {requests.length === 0 ? (
        <p className="text-muted-foreground">No pending service requests.</p>
      ) : (
        <div className="space-y-4">
          {requests.map((r) => (
            <Card key={r.id}>
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
        </div>
      )}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm">{value || '—'}</p>
    </div>
  );
}
