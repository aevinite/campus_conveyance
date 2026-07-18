'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { reserveSchema, cancelSchema, paySchema, studentDetailsSchema } from './schemas';
import { reserveSeat, cancelBooking, saveStudentDetails, payBooking } from './services';
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
    revalidatePath('/student/bookings');
    revalidatePath(`/student/routes/${parsed.data.routeId}`);
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
    revalidatePath('/student/bookings');
    revalidatePath('/student');
    // Refresh the route detail page too (its seat count + resume-payment panel
    // both change once the seat is confirmed). routeId is passed by the form.
    const routeId = String(formData.get('routeId') ?? '');
    if (routeId) revalidatePath(`/student/routes/${routeId}`);
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
  const db = await createClient();
  try {
    await cancelBooking(db, parsed.data.bookingId);
  } catch (e) {
    // Surface the failure to the user instead of crashing the page.
    return { error: toErrorResponse(e).message };
  }
  revalidatePath('/student/bookings');
  revalidatePath('/student');
  return { ok: true };
}
