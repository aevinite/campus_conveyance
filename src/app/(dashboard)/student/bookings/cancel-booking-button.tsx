'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { cancelBookingAction, type CancelState } from '@/features/booking/actions';
import { SubmitButton } from '@/components/submit-button';
import { Button } from '@/components/ui/button';

export function CancelBookingButton({
  bookingId,
  paid = false,
}: {
  bookingId: string;
  /** A paid booking → warn about (mock) refund handling before cancelling. */
  paid?: boolean;
}) {
  const [state, action] = useActionState<CancelState, FormData>(cancelBookingAction, {});
  const [confirming, setConfirming] = useState(false);
  const lastShown = useRef<CancelState>({});

  useEffect(() => {
    if (state === lastShown.current) return;
    if (state.error) toast.error(state.error);
    else if (state.ok) {
      toast.success('Booking cancelled.');
      setConfirming(false);
    }
    lastShown.current = state;
  }, [state]);

  return (
    <>
      {/* Cancelling is destructive and, for a paid seat, involves a refund — so
          require an explicit confirmation instead of a one-click cancel. */}
      <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
        Cancel
      </Button>

      {confirming && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-label="Cancel booking"
        >
          <div className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-6 shadow-xl">
            <div className="flex items-center gap-2.5">
              <span className="grid size-10 place-items-center rounded-xl bg-warning/10 text-warning">
                <AlertTriangle className="size-5" />
              </span>
              <h2 className="text-lg font-semibold">Cancel this booking?</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              This frees your seat and can&apos;t be undone — you&apos;d have to request it again.
              {paid && ' Since you have already paid, any refund will be processed by the agency as per their policy.'}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
                Keep booking
              </Button>
              <form action={action}>
                <input type="hidden" name="bookingId" value={bookingId} />
                <SubmitButton variant="destructive" size="sm" pendingText="Cancelling…">
                  Yes, cancel
                </SubmitButton>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
