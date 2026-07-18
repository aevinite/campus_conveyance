'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { addRouteAction, type FormState } from '@/features/agency/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectMenu } from '@/components/ui/select-menu';
import { TimePicker } from '@/components/ui/time-picker';
import { FormStatus } from '@/components/form-status';
import MapStopPicker, { type Stop } from './map-stop-picker';

export function RouteForm({
  colleges,
  buses,
  busesExist = false,
}: {
  colleges: { id: string; name: string }[];
  buses: { id: string; label: string }[];
  busesExist?: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    addRouteAction,
    {},
  );
  const [stops, setStops] = useState<Stop[]>([]);
  const formRef = useRef<HTMLFormElement>(null);

  // After a successful add, clear the form + stops for the next route.
  useEffect(() => {
    if (state.message) {
      formRef.current?.reset();
      setStops([]);
    }
    // Whole state object (new each dispatch) so identical messages still re-fire.
  }, [state]);

  const stopsValid = stops.length > 0 && stops.every((s) => s.description.trim().length > 0);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="institutionId">End location (school / college)</Label>
        {colleges.length === 0 ? (
          <p className="text-xs text-warning">
            No colleges yet — request a college under Profile first.
          </p>
        ) : colleges.length === 1 ? (
          <>
            <input type="hidden" name="institutionId" value={colleges[0].id} />
            <div className="flex h-9 w-full items-center gap-2 rounded-lg border border-input bg-muted/30 px-3 text-sm">
              <MapPin className="size-4 shrink-0 text-muted-foreground" />
              <span className="font-medium">{colleges[0].name}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Your registered college — the route always ends here.
            </p>
          </>
        ) : (
          <>
            <SelectMenu
              id="institutionId"
              name="institutionId"
              searchable
              placeholder="Select the college / school"
              searchPlaceholder="Search your colleges/schools…"
              options={colleges.map((c) => ({ value: c.id, label: c.name }))}
            />
            <p className="text-xs text-muted-foreground">
              Only the colleges/schools you registered for are listed.
            </p>
          </>
        )}
      </div>

      {/* Pickup stops on the map (submitted as JSON) */}
      <div className="space-y-1.5">
        <Label>Pickup stops (where the bus stops for children)</Label>
        <input type="hidden" name="stops" value={JSON.stringify(stops)} />
        <MapStopPicker value={stops} onChange={setStops} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="vehicleId">Bus</Label>
        <SelectMenu
          id="vehicleId"
          name="vehicleId"
          placeholder="Select a bus"
          options={buses.map((b) => ({ value: b.id, label: b.label }))}
        />
        {buses.length === 0 && (
          <p className="text-xs text-warning">
            {busesExist
              ? 'All your buses are already assigned to routes — add another bus to create a new route.'
              : 'Add a bus first.'}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="priceRupees">Route price (₹)</Label>
          <Input id="priceRupees" name="priceRupees" type="number" min={0} step="1" required />
        </div>
        <div className="space-y-1.5">
          <Label>Departure time</Label>
          <TimePicker name="departureTime" />
        </div>
      </div>

      <FormStatus error={state.error} message={state.message} />
      <Button type="submit" disabled={pending || !stopsValid}>
        {pending ? 'Saving…' : 'Add route'}
      </Button>
      {stops.length === 0 ? (
        <p className="text-xs text-muted-foreground">Add at least one pickup stop to save the route.</p>
      ) : !stopsValid ? (
        <p className="text-xs text-warning">Add a description (exact spot) for every pickup stop to continue.</p>
      ) : null}
    </form>
  );
}
