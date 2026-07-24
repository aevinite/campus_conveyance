import { z } from 'zod';

export const reviewSchema = z.object({
  agencyId: z.string().uuid(),
  rating: z.coerce.number().int().min(1, 'Please pick 1–5 stars.').max(5),
  comment: z.string().max(1000, 'Keep your review under 1000 characters.').optional(),
});

export const deleteReviewSchema = z.object({ agencyId: z.string().uuid() });

export type ReviewInput = z.infer<typeof reviewSchema>;
