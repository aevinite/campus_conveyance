'use client';
import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, IndianRupee, MapPin, Pencil, X } from 'lucide-react';
import { updateRouteAction, type FormState } from '@/features/agency/actions';
import type { RouteFull } from '@/features/agency/repository';
import MapStopPicker, { type Stop } from '../add-route/map-stop-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TimePicker } from '@/components/ui/time-picker';
import { FormStatus } from '@/components/form-status';

const rupees = (cents: number | null) => `₹${Math.round((cents ?? 0) / 100)}`;
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '');

export function EditableRouteCard({ route }: { route: RouteFull }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState<FormState, FormData>(updateRouteAction, {});
  const [stops, setStops] = useState<Stop[]>(
    route.stops
      .filter((s): s is RouteFull['stops'][number] & { lat: number; lng: number } => s.lat != null && s.lng != null)
      .map((s) => ({ name: s.name, description: s.description ?? '', lat: s.lat, lng: s.lng, address: s.address })),
  );

  useEffect(() => {
    if (state.message) {
      setEditing(false);
      router.refresh();
    }
    // Whole state object (new each dispatch) so identical messages still re-fire.
  }, [state, router]);

  const stopsValid = stops.length > 0 && stops.every((s) => s.description.trim().length > 0);

  // ---- View mode ----------------------------------------------------------
  if (!editing) {
    return (
      <div className="rounded-2xl border border-border bg-card/50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-lg font-semibold">{route.name}</p>
            <p className="text-sm text-muted-foreground">
              To {route.institutionName} · {route.busLabel}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <IndianRupee className="size-3.5" />
                {rupees(route.price_cents)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="size-3.5" />
                {hhmm(route.departure_time) || '—'}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5" />
                {route.stops.length} pickup stop{route.stops.length === 1 ? '' : 's'}
              </span>
            </div>
            {route.stops.length > 0 && (
              <p className="truncate text-xs text-muted-foreground">
                {route.stops.map((s) => s.name).join(' → ')}
              </p>
            )}
          </div>
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" />
            Edit
          </Button>
        </div>
      </div>
    );
  }

  // ---- Edit mode ----------------------------------------------------------
  return (
    <div className="rounded-2xl border border-primary/40 bg-card/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-semibold">Edit {route.name}</p>
        <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => setEditing(false)}>
          <X className="size-4" /> Cancel
        </Button>
      </div>

      <form action={action} className="space-y-4">
        <input type="hidden" name="routeId" value={route.id} />
        <input type="hidden" name="stops" value={JSON.stringify(stops)} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`price-${route.id}`}>Route price (₹)</Label>
            <Input
              id={`price-${route.id}`}
              name="priceRupees"
              type="number"
              min={0}
              step="1"
              required
              defaultValue={Math.round((route.price_cents ?? 0) / 100)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Departure time</Label>
            <TimePicker name="departureTime" defaultValue={hhmm(route.departure_time)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Pickup stops</Label>
          {route.hasBookings ? (
            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs text-warning">
                This route has bookings, so pickup stops are locked. You can still update the price and time.
              </p>
              <ol className="space-y-1 text-sm">
                {route.stops.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-muted-foreground">{i + 1}.</span>
                    <span>
                      {s.name}
                      {s.description ? ` — ${s.description}` : ''}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <MapStopPicker value={stops} onChange={setStops} />
          )}
        </div>

        <FormStatus error={state.error} message={state.message} />
        <div className="flex gap-2">
          <Button type="submit" disabled={pending || (!route.hasBookings && !stopsValid)}>
            {pending ? 'Saving…' : 'Save changes'}
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
        {!route.hasBookings && !stopsValid && (
          <p className="text-xs text-warning">Every pickup stop needs a description (exact spot).</p>
        )}
      </form>
    </div>
  );
}
