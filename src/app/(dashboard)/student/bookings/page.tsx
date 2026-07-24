import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CheckCircle2, Circle, Clock3, Timer, XCircle, AlertTriangle, Ticket, ArrowRight } from 'lucide-react';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { listMyBookings, countMyBookings, type BookingRow } from '@/features/booking/repository';
import { Card, CardContent } from '@/components/ui/card';
import { Pager, pageParams } from '@/components/pager';
import { CancelBookingButton } from './cancel-booking-button';
import { AgencyReviewWidget } from './agency-review-widget';
import { getMyReviews } from '@/features/reviews/repository';
import { formatTime } from '@/lib/format-date';
import { periodSuffix } from '@/lib/billing';

const PAGE_SIZE = 10;

const inr = (cents: number | null) =>
  cents == null || cents === 0
    ? null
    : `₹${Math.round(cents / 100).toLocaleString('en-IN')}`;

type StepState = 'done' | 'current' | 'upcoming' | 'failed';
interface TimelineStep {
  state: StepState;
  label: string;
}

/**
 * The booking lifecycle as a readable timeline:
 *   request → agency approval → payment window (20 min) → confirmed,
 * with terminal lines for cancelled / rejected / expired outcomes.
 */
function timelineFor(b: BookingRow): TimelineStep[] {
  const approved = Boolean(b.approved_at);

  if (b.status === 'WAITLISTED') {
    return [
      { state: 'done', label: 'Request sent' },
      { state: 'current', label: 'Waitlisted — the bus is full. We will notify you if a seat opens up.' },
    ];
  }
  if (b.status === 'REJECTED') {
    return [
      { state: 'done', label: 'Request sent' },
      { state: 'failed', label: 'Agency rejected your request.' },
    ];
  }
  if (b.status === 'CANCELLED') {
    // Only the payment-window sweep records PAYMENT_TIMEOUT; a student who
    // cancels voluntarily is 'STUDENT' (or null for older/agency-side cancels),
    // so we no longer mislabel a voluntary cancel as a missed-payment timeout.
    const timedOut = b.cancel_cause === 'PAYMENT_TIMEOUT';
    return [
      { state: 'done', label: 'Request sent' },
      ...(approved ? [{ state: 'done', label: 'Agency approved your request' } as TimelineStep] : []),
      {
        state: 'failed',
        label: timedOut
          ? "Booking cancelled because payment wasn't received in time."
          : 'Booking cancelled.',
      },
    ];
  }
  if (b.status === 'CONFIRMED') {
    return [
      { state: 'done', label: 'Request sent' },
      { state: 'done', label: 'Agency approved your request' },
      { state: 'done', label: 'Payment received' },
      { state: 'done', label: 'Booking confirmed' },
    ];
  }
  // PENDING
  if (!approved) {
    return [
      { state: 'done', label: 'Request sent' },
      { state: 'current', label: 'Waiting for agency approval' },
      { state: 'upcoming', label: 'Complete payment within 20 minutes of approval' },
      { state: 'upcoming', label: 'Booking confirmed' },
    ];
  }
  if (!b.is_paid) {
    return [
      { state: 'done', label: 'Request sent' },
      { state: 'done', label: 'Agency approved your request' },
      {
        state: 'current',
        label: b.expires_at
          ? `Complete payment before ${formatTime(b.expires_at)}`
          : 'Complete payment within 20 minutes',
      },
      { state: 'upcoming', label: 'Booking confirmed' },
    ];
  }
  // Legacy pay-first booking still awaiting the agency.
  return [
    { state: 'done', label: 'Request sent' },
    { state: 'done', label: 'Payment received' },
    { state: 'current', label: 'Waiting for agency confirmation' },
  ];
}

function StepIcon({ state, isLast }: { state: StepState; isLast: boolean }) {
  const icon =
    state === 'done' ? (
      <CheckCircle2 className="size-4 text-success" />
    ) : state === 'failed' ? (
      <XCircle className="size-4 text-destructive" />
    ) : state === 'current' ? (
      isLast ? (
        <Clock3 className="size-4 text-warning" />
      ) : (
        <Timer className="size-4 text-warning" />
      )
    ) : (
      <Circle className="size-4 text-border" />
    );
  return (
    <span className="flex flex-col items-center">
      {icon}
      {!isLast && <span className="mt-0.5 h-3.5 w-px bg-border" />}
    </span>
  );
}

function statusPill(b: BookingRow) {
  const map: Record<string, { label: string; cls: string }> = {
    CONFIRMED: { label: 'Confirmed', cls: 'border-success/30 bg-success/10 text-success' },
    WAITLISTED: { label: 'Waitlisted', cls: 'border-warning/30 bg-warning/10 text-warning' },
    CANCELLED: { label: 'Cancelled', cls: 'border-border bg-muted text-muted-foreground' },
    REJECTED: { label: 'Rejected', cls: 'border-destructive/30 bg-destructive/10 text-destructive' },
  };
  const pending = !b.approved_at
    ? { label: 'Awaiting approval', cls: 'border-warning/30 bg-warning/10 text-warning' }
    : b.is_paid
      ? { label: 'Paid — awaiting confirmation', cls: 'border-primary/30 bg-primary/10 text-primary' }
      : { label: 'Approved — pay now', cls: 'border-primary/30 bg-primary/10 text-primary' };
  const m = map[b.status] ?? pending;
  return (
    <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${m.cls}`}>
      {m.label}
    </span>
  );
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireRole('STUDENT');
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, PAGE_SIZE);
  const db = await createClient();
  // Lapsed holds are swept by the pg_cron 'expire-stale-holds' job (migration
  // 0052), not per request, so this page no longer issues a table UPDATE on load.
  // Paginated so the timeline doesn't fetch the student's entire history at once.
  const [bookings, total, myReviews] = await Promise.all([
    listMyBookings(db, { limit: PAGE_SIZE, offset }),
    countMyBookings(db),
    getMyReviews(db),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/student/bookings?page=${totalPages}`);

  return (
    <section className="max-w-2xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            Your rides
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">My Bookings</h1>
        </div>
        <Link
          href="/student/schools"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition-colors hover:text-primary/70"
        >
          Reserve a seat
          <ArrowRight className="size-4" />
        </Link>
      </div>
      {bookings.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border py-16 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
            <Ticket className="size-6" />
          </span>
          <p className="font-semibold">No bookings yet</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            You haven&apos;t reserved a seat yet — pick a campus to book your daily ride.
          </p>
          <Link
            href="/student/schools"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition-colors hover:text-primary/70"
          >
            Browse campuses <ArrowRight className="size-4" />
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => {
            const steps = timelineFor(b);
            // Holds now expire via pg_cron, not per request, so between lapse and
            // the next sweep a booking can still read PENDING+approved+unpaid.
            // Treat a passed expires_at as expired here so we don't show a live
            // "Pay now" button that would just fail.
            // Reading the clock during render is correct here (compares an
            // expiry to "now"); not a compiler purity hazard for this list.
            // eslint-disable-next-line react-hooks/purity
            const windowOpen = !b.expires_at || new Date(b.expires_at).getTime() > Date.now();
            const payNow =
              b.status === 'PENDING' && b.approved_at && !b.is_paid && b.routeId && windowOpen;
            return (
              <Card key={b.id}>
                <CardContent className="space-y-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                        {b.routeName}
                        {inr(b.price_cents) && (
                          <span className="tnum text-sm font-normal text-muted-foreground">
                            · {inr(b.price_cents)}
                            {periodSuffix(b.billing_period)}
                          </span>
                        )}
                        {statusPill(b)}
                      </p>
                    </div>
                    {b.status !== 'CANCELLED' && b.status !== 'REJECTED' && (
                      <CancelBookingButton bookingId={b.id} routeId={b.routeId} paid={b.is_paid} />
                    )}
                  </div>

                  {(b.status === 'CONFIRMED' || b.status === 'PENDING') && b.driver_name && (
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                      {b.bus_number && <span>Bus {b.bus_number}</span>}
                      <span>
                        Driver: {b.driver_name}
                        {b.driver_phone ? ` (${b.driver_phone})` : ''}
                      </span>
                      {b.driver_changed && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                          Driver changed for today
                        </span>
                      )}
                    </p>
                  )}

                  {/* Lifecycle timeline */}
                  <ol className="space-y-0 text-sm">
                    {steps.map((s, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <StepIcon state={s.state} isLast={i === steps.length - 1} />
                        <span
                          className={`-mt-0.5 pb-2 ${
                            s.state === 'failed'
                              ? 'text-destructive'
                              : s.state === 'current'
                                ? 'font-medium'
                                : s.state === 'upcoming'
                                  ? 'text-muted-foreground'
                                  : ''
                          }`}
                        >
                          {s.label}
                        </span>
                      </li>
                    ))}
                  </ol>

                  {payNow && (
                    <Link
                      href={`/student/routes/${b.routeId}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:-translate-y-0.5"
                    >
                      <AlertTriangle className="size-4" /> Pay now to confirm your seat
                    </Link>
                  )}

                  {/* Only a real rider (confirmed booking) can rate the agency. */}
                  {b.status === 'CONFIRMED' && b.agencyId && b.agencyName && (
                    <AgencyReviewWidget
                      agencyId={b.agencyId}
                      agencyName={b.agencyName}
                      existing={myReviews.get(b.agencyId) ?? null}
                    />
                  )}
                </CardContent>
              </Card>
            );
          })}
          <Pager page={page} totalPages={totalPages} basePath="/student/bookings" />
        </div>
      )}
    </section>
  );
}
