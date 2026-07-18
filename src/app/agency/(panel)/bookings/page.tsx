import { createClient } from '@/lib/supabase/server';
import { getMyAgency, listMyBookings } from '@/features/agency/repository';
import { confirmBookingAction, rejectBookingAction } from '@/features/agency/actions';
import { SubmitButton } from '@/components/submit-button';
import { BookingCard } from '../booking-card';

export default async function AgencyManageBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const { notice } = await searchParams;
  const db = await createClient();
  // Cancel approved requests whose 20-minute payment window lapsed, so they
  // don't linger here as "awaiting payment".
  await db.rpc('expire_stale_holds');
  const agency = await getMyAgency(db);
  const bookings = agency ? await listMyBookings(db, agency.id) : [];
  const pending = bookings.filter((b) => b.status === 'PENDING');

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Manage Booking</h1>
      <p className="text-sm text-muted-foreground">
        Requests are approved automatically once the seat, pickup and campus eligibility check out —
        the student then has 20 minutes to pay, and payment confirms the seat and onboards them under
        Manage Students. Review the details below and reject any request you don&apos;t want to honour.
      </p>

      {notice && (
        <p
          role="alert"
          className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning"
        >
          {notice}
        </p>
      )}

      {pending.length === 0 ? (
        <p className="rounded-lg border border-border bg-card/40 p-6 text-sm text-muted-foreground">
          No pending booking requests.
        </p>
      ) : (
        <div className="space-y-4">
          {pending.map((b) => (
            <BookingCard
              key={b.booking_id}
              b={b}
              action={
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <div className="flex gap-2">
                    {b.is_paid ? (
                      // Legacy pay-first booking: money already received.
                      <form action={confirmBookingAction}>
                        <input type="hidden" name="bookingId" value={b.booking_id} />
                        <SubmitButton size="sm" pendingText="Confirming…">
                          Confirm
                        </SubmitButton>
                      </form>
                    ) : !b.approved_at ? (
                      <form action={confirmBookingAction}>
                        <input type="hidden" name="bookingId" value={b.booking_id} />
                        <SubmitButton size="sm" pendingText="Approving…">
                          Approve
                        </SubmitButton>
                      </form>
                    ) : null}
                    <form action={rejectBookingAction}>
                      <input type="hidden" name="bookingId" value={b.booking_id} />
                      <SubmitButton size="sm" variant="destructive" pendingText="Rejecting…">
                        Reject
                      </SubmitButton>
                    </form>
                  </div>
                  {!b.is_paid && b.approved_at && (
                    <p className="text-xs text-muted-foreground">
                      Approved — awaiting the student&apos;s payment
                      {b.payment_due
                        ? ` (due ${new Date(b.payment_due).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })})`
                        : ''}
                      . The seat confirms automatically once paid.
                    </p>
                  )}
                </div>
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}
