'use server';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { reserveSchema, cancelSchema, paySchema, studentDetailsSchema } from './schemas';
import { reserveSeat, cancelBooking, saveStudentDetails, payBooking } from './services';
import { drainEmailOutbox } from '@/lib/email-outbox';
import { drainPushOutbox } from '@/lib/push';
import { toErrorResponse } from '@/lib/errors/app-error';

export type ReserveState = {
  status?: string;
  bookingId?: string;
  approvedAt?: string | null;
  expiresAt?: string | null;
  error?: string;
};
export type CancelState = { ok?: boolean; error?: string };
export type DetailsState = { ok?: boolean; error?: string };
export type PayState = { status?: string; error?: string; code?: string };

export async function reserveSeatAction(
  _: ReserveState,
  formData: FormData,
): Promise<ReserveState> {
  const parsed = reserveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Please choose a pickup stop.' };
  const db = await createClient();
  try {
    const result = await reserveSeat(db, parsed.data);
    // Flush the reserved/waitlisted email + push the DB trigger just queued.
    after(() => drainEmailOutbox());
    after(() => drainPushOutbox());
    // Broad layout revalidation so EVERY surface that shows this route's seat
    // count refreshes together — the campus/agency list cards, the route detail,
    // bookings and the home strip — never a stale seat number in one place while
    // another is fresh.
    revalidatePath('/student', 'layout');
    if (parsed.data.studentId) revalidatePath('/parent', 'layout');
    return {
      status: result.status,
      bookingId: result.id,
      approvedAt: result.approvedAt,
      expiresAt: result.expiresAt,
    };
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
}

/** Save student details before route selection. */
export async function saveStudentDetailsAction(
  _: DetailsState,
  formData: FormData,
): Promise<DetailsState> {
  const parsed = studentDetailsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please complete the form.' };
  }
  const db = await createClient();
  try {
    await saveStudentDetails(db, parsed.data);
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  revalidatePath('/student', 'layout');
  return { ok: true };
}

/** Simulated payment → confirm the held seat. */
export async function payBookingAction(
  _: PayState,
  formData: FormData,
): Promise<PayState> {
  const parsed = paySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Please choose a payment method.' };
  const db = await createClient();
  try {
    const status = await payBooking(db, parsed.data.bookingId);
    // The CONFIRMED email (rich template) + push are enqueued by the booking_notify
    // DB trigger and delivered by the retry-backed outbox drainers below — no
    // one-shot send, so a transient SMTP hiccup can no longer lose the mail.
    after(() => drainEmailOutbox());
    after(() => drainPushOutbox());
    // Broad revalidation so the list cards, detail, bookings and home all reflect
    // the confirmed seat together (see reserveSeatAction).
    revalidatePath('/student', 'layout');
    const studentId = String(formData.get('studentId') ?? '');
    if (studentId) revalidatePath('/parent', 'layout');
    return { status };
  } catch (e) {
    const r = toErrorResponse(e);
    return { error: r.message, code: r.pgCode };
  }
}

export async function cancelBookingAction(
  _: CancelState,
  formData: FormData,
): Promise<CancelState> {
  const parsed = cancelSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Could not identify that booking.' };
  const d = parsed.data;
  // Build the refund payout object from whichever method the student chose.
  let refund: Record<string, string> | null = null;
  if (d.refundMethod === 'UPI' && d.upiId) {
    refund = { method: 'UPI', upi_id: d.upiId };
  } else if (d.refundMethod === 'BANK' && (d.accountNumber || d.accountName)) {
    refund = {
      method: 'BANK',
      account_name: d.accountName ?? '',
      account_number: d.accountNumber ?? '',
      ifsc: d.ifsc ?? '',
    };
  }
  const db = await createClient();
  try {
    await cancelBooking(db, d.bookingId, d.reason ?? null, refund);
  } catch (e) {
    // Surface the failure to the user instead of crashing the page.
    return { error: toErrorResponse(e).message };
  }
  // Cancelling frees a seat → may promote a waitlisted rider; flush both the
  // cancel notice (to parents) and any promotion email/push the trigger queued.
  after(() => drainEmailOutbox());
  after(() => drainPushOutbox());
  // Cancelling frees a seat → broad revalidation so every surface (list cards,
  // detail, bookings, home) shows the freed seat together (see reserveSeatAction).
  revalidatePath('/student', 'layout');
  if (d.studentId) revalidatePath('/parent', 'layout');
  return { ok: true };
}
