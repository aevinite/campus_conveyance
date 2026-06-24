'use client';
import { useActionState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { reserveSeatAction, type ReserveState } from '@/features/booking/actions';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { Stop } from '@/features/booking/repository';

const selectClass =
  'border-input bg-background flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm';

export function ReserveForm({
  routeId,
  stops,
  soldOut,
}: {
  routeId: string;
  stops: Stop[];
  soldOut: boolean;
}) {
  const [state, action, pending] = useActionState<ReserveState, FormData>(
    reserveSeatAction,
    {},
  );
  const lastShown = useRef<ReserveState>({});

  useEffect(() => {
    if (state === lastShown.current) return;
    if (state.error) toast.error(state.error);
    else if (state.status === 'CONFIRMED') toast.success('Seat confirmed!');
    else if (state.status === 'WAITLISTED')
      toast.warning('Bus is full — you are on the waitlist.');
    lastShown.current = state;
  }, [state]);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="routeId" value={routeId} />
      <div className="space-y-2">
        <Label htmlFor="pickupStopId">Pickup stop</Label>
        <select id="pickupStopId" name="pickupStopId" className={selectClass} required>
          {stops.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="dropStopId">Drop stop</Label>
        <select
          id="dropStopId"
          name="dropStopId"
          className={selectClass}
          defaultValue={stops[stops.length - 1]?.id}
          required
        >
          {stops.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? 'Reserving…' : soldOut ? 'Join waitlist' : 'Reserve seat'}
      </Button>
    </form>
  );
}
