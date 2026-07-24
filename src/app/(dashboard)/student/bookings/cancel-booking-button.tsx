'use client';
import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { cancelBookingAction, type CancelState } from '@/features/booking/actions';
import { SubmitButton } from '@/components/submit-button';
import { Button } from '@/components/ui/button';
import { useModalFocusTrap } from '@/lib/use-modal-focus-trap';

export function CancelBookingButton({
  bookingId,
  routeId,
  paid = false,
}: {
  bookingId: string;
  /** The booking's route — lets the action revalidate that route's detail page
   *  (its seat count changes when the seat is freed). */
  routeId?: string | null;
  /** A paid booking → warn about (mock) refund handling before cancelling. */
  paid?: boolean;
}) {
  const [state, action] = useActionState<CancelState, FormData>(cancelBookingAction, {});
  const [confirming, setConfirming] = useState(false);
  const lastShown = useRef<CancelState>({});
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (state === lastShown.current) return;
    if (state.error) toast.error(state.error);
    else if (state.ok) {
      toast.success('Booking cancelled.');
      // Reacting to a completed useActionState result (guarded by lastShown) —
      // runtime-correct, not a cascading-render hazard.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConfirming(false);
    }
    lastShown.current = state;
  }, [state]);

  useModalFocusTrap(confirming, dialogRef, () => setConfirming(false));

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
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setConfirming(false);
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            tabIndex={-1}
            className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-6 shadow-xl outline-none"
          >
            <div className="flex items-center gap-2.5">
              <span className="grid size-10 place-items-center rounded-xl bg-warning/10 text-warning">
                <AlertTriangle className="size-5" />
              </span>
              <h2 id={titleId} className="text-lg font-semibold">Cancel this booking?</h2>
            </div>
            <p id={descId} className="text-sm text-muted-foreground">
              This frees your seat and can&apos;t be undone — you&apos;d have to request it again.
              {paid && ' Since you have already paid, any refund will be processed by the agency as per their policy.'}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
                Keep booking
              </Button>
              <form action={action}>
                <input type="hidden" name="bookingId" value={bookingId} />
                {routeId && <input type="hidden" name="routeId" value={routeId} />}
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
