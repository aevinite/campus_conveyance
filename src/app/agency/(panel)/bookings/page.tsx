import { redirect } from 'next/navigation';
import { Inbox } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getMyAgency, listMyBookings, countMyBookings } from '@/features/agency/repository';
import { confirmBookingAction, rejectBookingAction } from '@/features/agency/actions';
import { SubmitButton } from '@/components/submit-button';
import { BookingCard } from '../booking-card';
import { Pager } from '@/components/pager';
import { formatTime } from '@/lib/format-date';

const PAGE_SIZE = 20;

export default async function AgencyManageBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; page?: string }>;
}) {
  const { notice, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const db = await createClient();
  // Lapsed payment windows are cancelled by the pg_cron 'expire-stale-holds' job
  // (migration 0052), not per request.
  const agency = await getMyAgency(db);
  // Filter to PENDING + paginate in the DB — don't pull the whole history and
  // filter in JS.
  const [pending, total] = agency
    ? await Promise.all([
        listMyBookings(db, agency.id, {
          status: 'PENDING',
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        }),
        countMyBookings(db, agency.id, 'PENDING'),
      ])
    : [[], 0];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Don't strand on an out-of-range page after approving/rejecting the last
  // pending request on the final page.
  if (total > 0 && page > totalPages) redirect(`/agency/bookings?page=${totalPages}`);

  return (
    <section className="space-y-4">
      <div>
        <span className="text-xs font-semibold uppercase tracking-widest text-primary">Bookings</span>
        <h1 className="mt-1 text-2xl font-heading font-bold tracking-tight sm:text-3xl">Manage booking</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Requests are approved automatically once the seat, pickup and campus eligibility check out —
          the student then has 10 minutes to pay, and payment confirms the seat and onboards them under
          Manage Students. Review the details below and reject any request you don&apos;t want to honour.
        </p>
      </div>

      {notice && (
        <p
          role="alert"
          className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning"
        >
          {notice}
        </p>
      )}

      {pending.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card/40 p-10 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Inbox className="size-6" />
          </span>
          <div>
            <p className="font-medium">No pending booking requests</p>
            <p className="mt-1 text-sm text-muted-foreground">New requests will show up here for review.</p>
          </div>
        </div>
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
                      {b.payment_due ? ` (due ${formatTime(b.payment_due)})` : ''}
                      . The seat confirms automatically once paid.
                    </p>
                  )}
                </div>
              }
            />
          ))}
          <Pager page={page} totalPages={totalPages} basePath="/agency/bookings" />
        </div>
      )}
    </section>
  );
}
