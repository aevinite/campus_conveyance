import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReviewInput } from './schemas';
import { AppError } from '@/lib/errors/app-error';

/** Upsert the caller's review for an agency (security-definer RPC gates on a
 *  CONFIRMED booking with that agency). */
export async function submitReview(db: SupabaseClient, input: ReviewInput): Promise<void> {
  const { error } = await db.rpc('submit_review', {
    p_agency_id: input.agencyId,
    p_rating: input.rating,
    p_comment: input.comment ?? null,
  });
  if (error) throw new AppError('REVIEW', error.message, 400, error.code);
}

/** Remove the caller's own review for an agency. */
export async function deleteMyReview(db: SupabaseClient, agencyId: string): Promise<void> {
  const { error } = await db.rpc('delete_my_review', { p_agency_id: agencyId });
  if (error) throw new AppError('REVIEW', error.message, 400, error.code);
}
