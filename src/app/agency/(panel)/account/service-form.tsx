'use client';
import { useActionState, useEffect, useRef } from 'react';
import { requestServiceAction, type FormState } from '@/features/agency/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectMenu } from '@/components/ui/select-menu';
import { FormStatus } from '@/components/form-status';

const fieldCls =
  'flex w-full rounded-lg border border-input bg-transparent px-3 text-sm shadow-2xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 dark:bg-input/30';

export function ServiceForm({
  institutions,
}: {
  institutions: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    requestServiceAction,
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the form after a request is filed so it's ready for the next one.
  useEffect(() => {
    if (state.message) formRef.current?.reset();
    // Key on the whole state object (fresh each dispatch), not state.message —
    // two saves that return the SAME message wouldn't re-run this otherwise.
  }, [state]);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="institutionId">School / College</Label>
        <SelectMenu
          id="institutionId"
          name="institutionId"
          searchable
          placeholder="Select a school/college"
          searchPlaceholder="Search schools/colleges…"
          options={institutions.map((i) => ({ value: i.id, label: i.name }))}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="vehicleType">Vehicle type</Label>
        <SelectMenu
          id="vehicleType"
          name="vehicleType"
          defaultValue="BUS"
          options={[
            { value: 'BUS', label: 'Bus' },
            { value: 'VAN', label: 'Van' },
          ]}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="name">Transport service name</Label>
        <Input id="name" name="name" required placeholder="e.g. City Express (Bus)" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="description">Description</Label>
        <textarea
          id="description"
          name="description"
          rows={3}
          required
          minLength={10}
          placeholder="Tell the admin what you'll run here — coverage, timings, fleet, etc."
          className={`${fieldCls} py-2`}
        />
        <p className="text-xs text-muted-foreground">
          Required. The admin reads this before approving the new service area.
        </p>
      </div>
      <FormStatus error={state.error} message={state.message} />
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Submitting…' : 'Submit request'}
      </Button>
    </form>
  );
}
