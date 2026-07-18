'use client';
import { useActionState } from 'react';
import { BadgeCheck } from 'lucide-react';
import type { FormState } from '@/features/admin/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectMenu } from '@/components/ui/select-menu';
import { FormStatus } from '@/components/form-status';

const fieldCls =
  'flex w-full rounded-lg border border-input bg-transparent px-3 text-sm shadow-2xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 dark:bg-input/30';

export interface CollegeDefaults {
  id?: string;
  name?: string;
  kind?: string;
  area?: string | null;
  city?: string | null;
  imageUrl?: string | null;
  description?: string | null;
  verified?: boolean;
}

export function CollegeForm({
  action,
  defaults = {},
  submitLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults?: CollegeDefaults;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  return (
    <form action={formAction} className="max-w-md space-y-4">
      {defaults.id && <input type="hidden" name="id" value={defaults.id} />}
      <div className="space-y-1.5">
        <Label htmlFor="name">College / School name</Label>
        <Input id="name" name="name" defaultValue={defaults.name ?? ''} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="kind">Type</Label>
        <SelectMenu
          id="kind"
          name="kind"
          defaultValue={defaults.kind ?? 'SCHOOL'}
          options={[
            { value: 'SCHOOL', label: 'School' },
            { value: 'COLLEGE', label: 'College / University' },
          ]}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="area">Area</Label>
          <Input id="area" name="area" defaultValue={defaults.area ?? ''} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="city">City</Label>
          <Input id="city" name="city" defaultValue={defaults.city ?? ''} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="imageUrl">Image link</Label>
        <Input id="imageUrl" name="imageUrl" type="url" defaultValue={defaults.imageUrl ?? ''} placeholder="https://…" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="description">Description</Label>
        <textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={defaults.description ?? ''}
          className={`${fieldCls} py-2`}
        />
      </div>
      <label className="flex items-start gap-3 rounded-lg border border-input p-3">
        <input
          type="checkbox"
          name="verified"
          defaultChecked={defaults.verified ?? false}
          className="mt-0.5 size-4 accent-[var(--success)]"
        />
        <span className="space-y-0.5">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <BadgeCheck className="size-4 text-success" />
            Verified institution
          </span>
          <span className="block text-xs text-muted-foreground">
            Shows a green verified tick beside the name to students.
          </span>
        </span>
      </label>
      <FormStatus error={state.error} message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : submitLabel}
      </Button>
    </form>
  );
}
