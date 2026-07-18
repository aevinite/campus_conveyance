import { createClient } from '@/lib/supabase/server';
import { listAgencyRequests, listRejectedAgencies } from '@/features/admin/repository';
import { approveAgencyAction, rejectAgencyAction, deleteAgencyAction } from '@/features/admin/actions';
import { Card, CardContent } from '@/components/ui/card';
import { SubmitButton } from '@/components/submit-button';
import { Input } from '@/components/ui/input';

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm">{value || '—'}</p>
    </div>
  );
}

export default async function AdminRequestsPage() {
  const db = await createClient();
  const [requests, rejected] = await Promise.all([
    listAgencyRequests(db),
    listRejectedAgencies(db),
  ]);

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Service Provider Requests</h1>
      {requests.length === 0 ? (
        <p className="text-muted-foreground">No pending applications.</p>
      ) : (
        <div className="space-y-4">
          {requests.map((r) => (
            <Card key={r.id}>
              <CardContent className="space-y-4 py-5">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Detail label="Company" value={r.name} />
                  <Detail label="Email" value={r.email} />
                  <Detail label="Contact person" value={r.contact_person} />
                  <Detail label="Phone" value={r.phone} />
                  <Detail label="Legal name" value={r.legal_name} />
                  <Detail label="Registration (CIN/Udyam)" value={r.registration_no} />
                  <Detail label="GST" value={r.gst_number} />
                  <Detail label="PAN" value={r.pan_number} />
                  <Detail label="Registered address" value={r.registered_address} />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Selected colleges / schools
                  </p>
                  {r.services.length === 0 ? (
                    <p className="text-sm text-muted-foreground">None selected.</p>
                  ) : (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {r.services.map((s, i) => (
                        <span
                          key={`${s.institutionName}-${s.vehicleType}-${i}`}
                          className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
                        >
                          {s.institutionName}
                          <span className="text-[0.65rem] uppercase text-primary/70">
                            {s.vehicleType === 'VAN' ? 'Van' : 'Bus'}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
                  <form action={approveAgencyAction}>
                    <input type="hidden" name="agencyId" value={r.id} />
                    <SubmitButton size="sm" pendingText="Accepting…">
                      Accept
                    </SubmitButton>
                  </form>
                  <form action={rejectAgencyAction} className="flex items-end gap-2">
                    <input type="hidden" name="agencyId" value={r.id} />
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

      {rejected.length > 0 && (
        <div className="space-y-3 pt-4">
          <h2 className="text-lg font-semibold text-muted-foreground">Rejected applications</h2>
          {rejected.map((r) => (
            <Card key={r.id}>
              <CardContent className="space-y-3 py-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Detail label="Company" value={r.name} />
                  <Detail label="Email" value={r.email} />
                  <Detail label="Contact person" value={r.contact_person} />
                  <Detail label="Rejection reason" value={r.rejected_reason ?? '—'} />
                </div>
                <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
                  {/* Re-approve (undo the rejection) or remove it for good. */}
                  <form action={approveAgencyAction}>
                    <input type="hidden" name="agencyId" value={r.id} />
                    <SubmitButton size="sm" pendingText="Approving…">
                      Approve instead
                    </SubmitButton>
                  </form>
                  <form action={deleteAgencyAction}>
                    <input type="hidden" name="agencyId" value={r.id} />
                    <SubmitButton size="sm" variant="destructive" pendingText="Removing…">
                      Remove
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
