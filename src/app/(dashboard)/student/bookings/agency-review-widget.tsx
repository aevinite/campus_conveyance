'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Star, Pencil, Trash2 } from 'lucide-react';
import {
  submitReviewAction,
  deleteMyReviewAction,
  type ReviewState,
} from '@/features/reviews/actions';
import { StarRating, StarRatingInput } from '@/components/ui/star-rating';
import { SubmitButton } from '@/components/submit-button';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

/**
 * "Rate this agency" widget shown on a CONFIRMED booking. One review per agency
 * per rider (editable) — the submit action upserts server-side, so if the rider
 * has several confirmed bookings with the same agency, each widget edits the
 * same review.
 */
export function AgencyReviewWidget({
  agencyId,
  agencyName,
  existing,
}: {
  agencyId: string;
  agencyName: string;
  existing?: { rating: number; comment: string | null } | null;
}) {
  const [state, action] = useActionState<ReviewState, FormData>(submitReviewAction, {});
  const [delState, delAction] = useActionState<ReviewState, FormData>(deleteMyReviewAction, {});
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const lastShown = useRef<ReviewState>({});
  const lastDel = useRef<ReviewState>({});

  useEffect(() => {
    if (state === lastShown.current) return;
    if (state.error) toast.error(state.error);
    else if (state.ok) {
      toast.success('Thanks for your review!');
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
    }
    lastShown.current = state;
  }, [state]);

  useEffect(() => {
    if (delState === lastDel.current) return;
    if (delState.error) toast.error(delState.error);
    else if (delState.ok) {
      toast.success('Review removed.');
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRating(0);
    }
    lastDel.current = delState;
  }, [delState]);

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            {existing ? 'Your rating for' : 'How was your ride with'}
          </span>
          <span className="font-semibold">{agencyName}</span>
          {existing && <StarRating value={existing.rating} size={15} />}
        </div>
        <div className="flex items-center gap-2">
          {open && existing && (
            // Sibling form (never nested inside the edit form below).
            <form action={delAction}>
              <input type="hidden" name="agencyId" value={agencyId} />
              <SubmitButton variant="ghost" size="sm" pendingText="Removing…">
                <Trash2 className="size-3.5" /> Remove
              </SubmitButton>
            </form>
          )}
          {!open && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRating(existing?.rating ?? 0);
                setOpen(true);
              }}
            >
              {existing ? (
                <>
                  <Pencil className="size-3.5" /> Edit review
                </>
              ) : (
                <>
                  <Star className="size-3.5" /> Leave a review
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {open && (
        <form action={action} className="mt-3 space-y-3">
          <input type="hidden" name="agencyId" value={agencyId} />
          <input type="hidden" name="rating" value={rating} />
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Your rating</span>
            <StarRatingInput value={rating} onChange={setRating} />
          </div>
          <Textarea
            name="comment"
            rows={3}
            maxLength={1000}
            defaultValue={existing?.comment ?? ''}
            placeholder="Share how the service was — punctuality, driver, comfort… (optional)"
          />
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton size="sm" pendingText="Saving…" disabled={rating < 1}>
              {existing ? 'Update review' : 'Submit review'}
            </SubmitButton>
          </div>
        </form>
      )}
    </div>
  );
}
