'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { cancelBookingAction, type CancelState } from '@/features/booking/actions';
import { Button } from '@/components/ui/button';

/**
 * Lets a parent cancel a child's booking they manage (cancel_booking authorizes
 * a linked parent). Kept minimal — a confirm step, no refund form (a paid
 * booking's refund details can still be added later from the agency side).
 */
export function ChildCancelButton({
  bookingId,
  studentId,
}: {
  bookingId: string;
  studentId: string;
}) {
  const [state, action, pending] = useActionState<CancelState, FormData>(cancelBookingAction, {});
  const [confirm, setConfirm] = useState(false);
  const seen = useRef<CancelState>({});

  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    if (state.error) toast.error(state.error);
    else if (state.ok) toast.success('Booking cancelled.');
  }, [state]);

  if (!confirm) {
    return (
      <Button variant="outline" className="w-full" onClick={() => setConfirm(true)}>
        Cancel this booking
      </Button>
    );
  }

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="studentId" value={studentId} />
      <p className="text-sm text-muted-foreground">
        Cancel this booking? The seat is released and may be offered to someone else.
      </p>
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" className="flex-1" disabled={pending}>
          {pending ? 'Cancelling…' : 'Yes, cancel'}
        </Button>
        <Button type="button" variant="outline" className="flex-1" onClick={() => setConfirm(false)}>
          Keep it
        </Button>
      </div>
    </form>
  );
}
