'use client';
import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Wallet } from 'lucide-react';
import { cancelBookingAction, type CancelState } from '@/features/booking/actions';
import { SubmitButton } from '@/components/submit-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useModalFocusTrap } from '@/lib/use-modal-focus-trap';

type Phase = 'idle' | 'confirm' | 'details';
type Method = 'UPI' | 'BANK';

export function CancelBookingButton({
  bookingId,
  routeId,
  paid = false,
  studentId,
  refundPending = false,
}: {
  bookingId: string;
  /** The booking's route — lets the action revalidate that route's detail page
   *  (its seat count changes when the seat is freed). */
  routeId?: string | null;
  /** A paid booking → collect refund payout details before cancelling. */
  paid?: boolean;
  /** Set when a parent cancels a child's booking (revalidates /parent). */
  studentId?: string;
  /** The rider already requested cancellation of this paid booking — the refund
   *  is pending admin action, so show a locked "Refund pending" state. */
  refundPending?: boolean;
}) {
  const [state, action] = useActionState<CancelState, FormData>(cancelBookingAction, {});
  const [phase, setPhase] = useState<Phase>('idle');
  const [method, setMethod] = useState<Method>('UPI');
  const lastShown = useRef<CancelState>({});
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (state === lastShown.current) return;
    if (state.error) toast.error(state.error);
    else if (state.ok) {
      toast.success(paid ? 'Cancellation requested — refund pending.' : 'Booking cancelled.');
      // Reacting to a completed useActionState result (guarded by lastShown) —
      // runtime-correct, not a cascading-render hazard.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPhase('idle');
    }
    lastShown.current = state;
  }, [state]);

  const open = phase !== 'idle';
  useModalFocusTrap(open, dialogRef, () => setPhase('idle'));

  // Already requested — the seat is held until the admin processes the refund.
  if (refundPending) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs font-semibold text-warning">
        Refund pending
      </span>
    );
  }

  return (
    <>
      {/* Cancelling is destructive and, for a paid seat, involves a refund — so
          confirm first, then collect a reason + refund details. */}
      <Button variant="outline" size="sm" onClick={() => setPhase('confirm')}>
        Cancel
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-xs"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPhase('idle');
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="max-h-[85vh] w-full max-w-sm space-y-4 overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-xl outline-none"
          >
            {phase === 'confirm' ? (
              <>
                <div className="flex items-center gap-2.5">
                  <span className="grid size-10 place-items-center rounded-xl bg-warning/10 text-warning">
                    <AlertTriangle className="size-5" />
                  </span>
                  <h2 id={titleId} className="text-lg font-semibold">Cancel this booking?</h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  {paid
                    ? 'This sends a cancellation & refund request. Your seat stays reserved until we process your refund — we’ll ask where to send it on the next step.'
                    : 'This frees your seat and can’t be undone — you’d have to request it again.'}
                </p>
                {paid && (
                  <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <span>
                      <b>Refund policy:</b> you get a full refund only if you cancel within{' '}
                      <b>3 days</b> of booking. After that, a small deduction is applied before your
                      refund is processed.
                    </span>
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPhase('idle')}>
                    Keep booking
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => setPhase('details')}>
                    Yes, cancel
                  </Button>
                </div>
              </>
            ) : (
              // Step 2: reason + (for a paid seat) refund payout details.
              <form action={action} className="space-y-4">
                <input type="hidden" name="bookingId" value={bookingId} />
                {routeId && <input type="hidden" name="routeId" value={routeId} />}
                {studentId && <input type="hidden" name="studentId" value={studentId} />}
                {paid && <input type="hidden" name="refundMethod" value={method} />}

                <div className="flex items-center gap-2.5">
                  <span className="grid size-10 place-items-center rounded-xl bg-warning/10 text-warning">
                    <Wallet className="size-5" />
                  </span>
                  <h2 id={titleId} className="text-lg font-semibold">Before you go</h2>
                </div>

                {/* Reason */}
                <div className="space-y-1.5">
                  <Label htmlFor={`${titleId}-reason`}>Why are you cancelling?</Label>
                  <Textarea
                    id={`${titleId}-reason`}
                    name="reason"
                    required
                    minLength={3}
                    rows={3}
                    placeholder="Let the agency know why you're leaving…"
                  />
                </div>

                {/* Refund payout details — only when the booking was paid. */}
                {paid && (
                  <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-3">
                    <p className="text-sm font-medium">Where should we send your refund?</p>
                    <div className="grid grid-cols-2 gap-2">
                      {(['UPI', 'BANK'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          aria-pressed={method === m}
                          onClick={() => setMethod(m)}
                          className={cn(
                            'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                            method === m
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {m === 'UPI' ? 'UPI' : 'Bank account'}
                        </button>
                      ))}
                    </div>

                    {method === 'UPI' ? (
                      <div className="space-y-1.5">
                        <Label htmlFor={`${titleId}-upi`}>UPI ID</Label>
                        <Input id={`${titleId}-upi`} name="upiId" required placeholder="name@bank" />
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="space-y-1.5">
                          <Label htmlFor={`${titleId}-acname`}>Account holder name</Label>
                          <Input id={`${titleId}-acname`} name="accountName" required placeholder="Full name on the account" />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`${titleId}-acno`}>Account number</Label>
                          <Input id={`${titleId}-acno`} name="accountNumber" required inputMode="numeric" placeholder="Account number" />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`${titleId}-ifsc`}>IFSC code</Label>
                          <Input id={`${titleId}-ifsc`} name="ifsc" required placeholder="e.g. HDFC0001234" className="uppercase" />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setPhase('confirm')}>
                    Back
                  </Button>
                  <SubmitButton variant="destructive" size="sm" pendingText="Cancelling…">
                    Confirm cancellation
                  </SubmitButton>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
