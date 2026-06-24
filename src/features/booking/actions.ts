'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { reserveSchema, cancelSchema } from './schemas';
import { reserveSeat, cancelBooking } from './services';
import { toErrorResponse } from '@/lib/errors/app-error';

export type ReserveState = { status?: string; error?: string };

export async function reserveSeatAction(
  _: ReserveState,
  formData: FormData,
): Promise<ReserveState> {
  const parsed = reserveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Please choose a pickup and drop stop.' };
  const db = await createClient();
  try {
    const result = await reserveSeat(db, parsed.data);
    revalidatePath('/student/bookings');
    revalidatePath(`/student/routes/${parsed.data.routeId}`);
    return { status: result.status };
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
}

export async function cancelBookingAction(formData: FormData): Promise<void> {
  const parsed = cancelSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const db = await createClient();
  await cancelBooking(db, parsed.data.bookingId);
  revalidatePath('/student/bookings');
}
