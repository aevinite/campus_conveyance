// Shared booking status wording for the rider (student) and parent screens, so
// the same booking reads the same on both. Pure + framework-free.
import { computePass } from '@/lib/pass';
import type { BillingPeriod } from '@/lib/billing';

export type BookingTone = 'success' | 'warning' | 'primary' | 'muted' | 'destructive';

export interface BookingLabelInput {
  status: string;
  is_paid: boolean;
  payment_status: string | null;
  cancel_requested_at?: string | null;
  /** payments.refund_status (NONE / REQUESTED / PROCESSED / DECLINED), when known. */
  refund_status?: string | null;
  /** Omit when unknown — only a known-null value reads as "awaiting approval". */
  approved_at?: string | null;
}

/** Tailwind pill classes per tone (border + tinted background + text). */
export const TONE_PILL: Record<BookingTone, string> = {
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  primary: 'border-primary/30 bg-primary/10 text-primary',
  muted: 'border-border bg-muted text-muted-foreground',
  destructive: 'border-destructive/30 bg-destructive/10 text-destructive',
};

export function bookingStatusLabel(b: BookingLabelInput): { label: string; tone: BookingTone } {
  const verifying = !b.is_paid && b.payment_status === 'SUBMITTED';

  // A cancellation the family asked for that isn't final yet (seat still held).
  if ((b.status === 'CONFIRMED' || b.status === 'PENDING') && b.cancel_requested_at) {
    return verifying
      ? { label: 'Cancellation requested — verifying payment', tone: 'warning' }
      : { label: 'Cancellation requested — refund pending', tone: 'warning' };
  }

  if (b.status === 'CANCELLED' || b.status === 'REJECTED') {
    const closed = b.status === 'CANCELLED' ? 'Cancelled' : 'Rejected';
    // Closed while (or after) a UPI payment was sent: it's still being checked.
    if (verifying) return { label: `${closed} — verifying payment`, tone: 'warning' };
    if (b.refund_status === 'REQUESTED') return { label: `${closed} — refund pending`, tone: 'warning' };
    if (b.refund_status === 'PROCESSED') return { label: `${closed} — refunded`, tone: 'muted' };
    return { label: closed, tone: b.status === 'CANCELLED' ? 'muted' : 'destructive' };
  }

  if (b.status === 'PENDING') {
    if (b.approved_at === null) return { label: 'Awaiting approval', tone: 'warning' };
    if (b.is_paid) return { label: 'Paid — awaiting confirmation', tone: 'primary' };
    if (verifying) return { label: 'Verifying payment', tone: 'primary' };
    if (b.payment_status === 'REJECTED') return { label: 'Payment failed — pay again', tone: 'destructive' };
    return { label: 'Awaiting payment', tone: 'primary' };
  }

  if (b.status === 'CONFIRMED') return { label: 'Confirmed', tone: 'success' };
  if (b.status === 'WAITLISTED') return { label: 'Waitlisted', tone: 'warning' };
  return { label: b.status, tone: 'muted' };
}

/**
 * Client mirror of the DB's booking_is_active_ride(): a CONFIRMED seat with no
 * cancellation pending and a pass that hasn't ended. Only these rides ever show
 * a live bus, get "bus arriving" alerts, or should poll the bus location.
 */
export function isActiveRide(b: {
  status: string;
  cancel_requested_at?: string | null;
  billing_period?: string | null;
  /** Pass-window start (pass_start_at ?? paid_at ?? created_at). */
  passStartIso?: string | null;
}): boolean {
  if (b.status !== 'CONFIRMED' || b.cancel_requested_at) return false;
  if (!b.billing_period) return true;
  const pass = computePass(b.passStartIso ?? null, b.billing_period as BillingPeriod);
  return !pass || !pass.expired;
}

/** One-line note shown under a route map when live tracking is off. */
export function liveTrackingNote(b: { status: string; cancel_requested_at?: string | null }): string {
  if (b.cancel_requested_at) return 'Live tracking is paused while the cancellation is being processed.';
  if (b.status === 'CONFIRMED') return 'Live tracking is off — this bus pass has ended.';
  if (b.status === 'WAITLISTED') return 'Live tracking starts once a seat opens up and is confirmed.';
  return 'Live tracking starts once the seat is confirmed.';
}
