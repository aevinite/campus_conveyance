'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { AppError, toErrorResponse } from '@/lib/errors/app-error';

export type MarkStageResult = { ok?: boolean; stage?: string; error?: string };

const schema = z.object({
  bookingId: z.string().uuid(),
  stage: z.enum(['BOARDED', 'REACHED', 'GOT_OFF']),
});

/**
 * Record a journey stage for one of the driver's riders. The RPC authorizes
 * that the rider is on this driver's bus and fans out an in-app notification to
 * the student and any linked parents.
 */
export async function markRideStageAction(
  bookingId: string,
  stage: string,
): Promise<MarkStageResult> {
  const parsed = schema.safeParse({ bookingId, stage });
  if (!parsed.success) return { error: 'Could not record that update.' };
  const db = await createClient();
  try {
    const { error } = await db.rpc('driver_mark_stage', {
      p_booking_id: parsed.data.bookingId,
      p_stage: parsed.data.stage,
    });
    if (error) throw new AppError('DRIVER', error.message);
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  revalidatePath('/driver/riders');
  return { ok: true, stage: parsed.data.stage };
}

export type OnlineResult = { ok?: boolean; online?: boolean; error?: string };

/** Flip the driver online/offline. Offline clears the stored live location. */
export async function setDriverOnlineAction(online: boolean): Promise<OnlineResult> {
  const db = await createClient();
  try {
    const { error } = await db.rpc('driver_set_online', { p_online: online });
    if (error) throw new AppError('DRIVER', error.message);
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  return { ok: true, online };
}

// The frequent GPS ping moved to the /api/driver-location route handler (lighter
// than a server action on a ~9s cadence); see components/driver-tracker.tsx.
