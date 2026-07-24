'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { reviewSchema, deleteReviewSchema } from './schemas';
import { submitReview, deleteMyReview } from './services';
import { toErrorResponse } from '@/lib/errors/app-error';

export type ReviewState = { ok?: boolean; error?: string };

/** Submit or update the caller's review for an agency. */
export async function submitReviewAction(
  _: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const parsed = reviewSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please pick a rating.' };
  }
  const db = await createClient();
  try {
    await submitReview(db, parsed.data);
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  revalidatePath('/student/bookings');
  return { ok: true };
}

/** Delete the caller's own review for an agency. */
export async function deleteMyReviewAction(
  _: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const parsed = deleteReviewSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Could not identify the agency.' };
  const db = await createClient();
  try {
    await deleteMyReview(db, parsed.data.agencyId);
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  revalidatePath('/student/bookings');
  return { ok: true };
}
