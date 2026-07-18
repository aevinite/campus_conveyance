'use client';
import { useActionState, useState } from 'react';
import { updateAgencyProfileAction, type FormState } from '@/features/agency/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormStatus } from '@/components/form-status';

export interface AgencyProfileValues {
  name: string;
  contactPerson: string;
  phone: string;
  legalName: string;
  registrationNo: string;
  gstNumber: string;
  panNumber: string;
  registeredAddress: string;
  description: string;
  permitDocUrl: string;
  fitnessDocUrl: string;
}

const areaCls =
  'flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-2xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 dark:bg-input/30';

type ProfileAction = (state: FormState, formData: FormData) => Promise<FormState>;

/**
 * Business/verification form. Used by the agency to edit its own details, and by
 * the admin to edit any provider — the admin passes a different `action` plus the
 * target `agencyId` (sent as a hidden field).
 */
export function AgencyProfileForm({
  initial,
  action: submitAction = updateAgencyProfileAction,
  agencyId,
  submitLabel = 'Save business details',
}: {
  initial: AgencyProfileValues;
  action?: ProfileAction;
  agencyId?: string;
  submitLabel?: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(submitAction, {});
  // Controlled so values persist across the post-save re-render (Base UI warns if
  // an uncontrolled field's default changes after mount).
  const [v, setV] = useState<AgencyProfileValues>(initial);
  const set =
    (k: keyof AgencyProfileValues) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setV((s) => ({ ...s, [k]: e.target.value }));

  return (
    <form action={action} className="space-y-4">
      {agencyId && <input type="hidden" name="agencyId" value={agencyId} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Provider / Company name" name="name" value={v.name} onChange={set('name')} />
        <Field
          label="Contact person name"
          name="contactPerson"
          value={v.contactPerson}
          onChange={set('contactPerson')}
        />
        <Field label="Phone" name="phone" type="tel" value={v.phone} onChange={set('phone')} />
        <Field
          label="Registered legal name"
          name="legalName"
          value={v.legalName}
          onChange={set('legalName')}
        />
        <Field
          label="Company registration no. (CIN / Udyam)"
          name="registrationNo"
          value={v.registrationNo}
          onChange={set('registrationNo')}
        />
        <Field label="GST number" name="gstNumber" value={v.gstNumber} onChange={set('gstNumber')} />
        <Field label="PAN number" name="panNumber" value={v.panNumber} onChange={set('panNumber')} />

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="registeredAddress">Registered address</Label>
          <textarea
            id="registeredAddress"
            name="registeredAddress"
            rows={2}
            required
            value={v.registeredAddress}
            onChange={set('registeredAddress')}
            className={areaCls}
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="description">Description (shown to students)</Label>
          <textarea
            id="description"
            name="description"
            rows={2}
            value={v.description}
            onChange={set('description')}
            placeholder="A short line about your service."
            className={areaCls}
          />
        </div>

        <Field
          label="Transport permit link (optional)"
          name="permitDocUrl"
          type="url"
          required={false}
          value={v.permitDocUrl}
          onChange={set('permitDocUrl')}
          placeholder="https://…"
        />
        <Field
          label="Fitness certificate link (optional)"
          name="fitnessDocUrl"
          type="url"
          required={false}
          value={v.fitnessDocUrl}
          onChange={set('fitnessDocUrl')}
          placeholder="https://…"
        />
      </div>

      <FormStatus error={state.error} message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : submitLabel}
      </Button>
    </form>
  );
}

function Field({
  label,
  name,
  value,
  onChange,
  type = 'text',
  required = true,
  placeholder,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        value={value}
        onChange={onChange}
        required={required}
        placeholder={placeholder}
        autoComplete="off"
      />
    </div>
  );
}
