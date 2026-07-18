import Link from 'next/link';
import { CheckCircle2, Circle, Clock3, Timer, XCircle, AlertTriangle } from 'lucide-react';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { listMyBookings, expireStaleHolds, type BookingRow } from '@/features/booking/repository';
import { Card, CardContent } from '@/components/ui/card';
import { CancelBookingButton } from './cancel-booking-button';

// IST — the payment deadline is rendered server-side; without an explicit zone
// it would show the server's timezone (UTC on most hosts), off by 5.5 hours.
const timeFmt = new Intl.DateTimeFormat('en-IN', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
});

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
          ? `Complete payment before ${timeFmt.format(new Date(b.expires_at))}`
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
    <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${m.cls}`}>
      {m.label}
    </span>
  );
}

export default async function BookingsPage() {
  await requireRole('STUDENT');
  const db = await createClient();
  // Sweep lapsed payment windows first so this list never shows a dead hold.
  await expireStaleHolds(db);
  const bookings = await listMyBookings(db);

  return (
    <section className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My Bookings</h1>
        <Link href="/student/schools" className="text-sm font-medium text-primary transition-colors hover:text-primary/70">
          Book a seat
        </Link>
      </div>
      {bookings.length === 0 ? (
        <p className="text-muted-foreground">You have no bookings yet.</p>
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => {
            const steps = timelineFor(b);
            const payNow =
              b.status === 'PENDING' && b.approved_at && !b.is_paid && b.routeId;
            return (
              <Card key={b.id}>
                <CardContent className="space-y-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                        {b.routeName}
                        {inr(b.price_cents) && (
                          <span className="text-sm font-normal text-muted-foreground">
                            · {inr(b.price_cents)}
                          </span>
                        )}
                        {statusPill(b)}
                      </p>
                    </div>
                    {b.status !== 'CANCELLED' && b.status !== 'REJECTED' && (
                      <CancelBookingButton bookingId={b.id} paid={b.is_paid} />
                    )}
                  </div>

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
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
