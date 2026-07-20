'use client';
import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IdCard, Mail, Pencil, Phone, User, X } from 'lucide-react';
import { updateDriverAction, softDeleteDriverAction, type FormState } from '@/features/agency/actions';
import type { DriverRow } from '@/features/agency/repository';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/auth/password-input';
import { Label } from '@/components/ui/label';
import { SelectMenu } from '@/components/ui/select-menu';
import { FormStatus } from '@/components/form-status';
import { ConfirmDeleteButton } from './confirm-delete-button';

function EditField({
  name,
  label,
  defaultValue,
  type = 'text',
  required = false,
}: {
  name: string;
  label: string;
  defaultValue?: string | null;
  type?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${name}-drv`}>{label}</Label>
      <Input
        id={`${name}-drv`}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue ?? ''}
        autoComplete="off"
      />
    </div>
  );
}

export function EditableDriverCard({ driver }: { driver: DriverRow }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState<FormState, FormData>(updateDriverAction, {});

  useEffect(() => {
    if (state.message) {
      setEditing(false);
      router.refresh();
    }
    // Whole state object (new each dispatch) so identical messages still re-fire.
  }, [state, router]);

  if (!editing) {
    return (
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border bg-card/50 p-4">
        <div className="flex min-w-0 gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
            <User className="size-5" />
          </span>
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{driver.name || '—'}</span>
              <span
                className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                  driver.is_active
                    ? 'border-success/40 bg-success/10 text-success'
                    : 'border-destructive/40 bg-destructive/10 text-destructive'
                }`}
              >
                {driver.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
            <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Mail className="size-3.5" /> {driver.email || '—'}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Phone className="size-3.5" /> {driver.phone || '—'}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <IdCard className="size-3.5" /> {driver.license_no || 'No licence'}
              </span>
            </div>
            {(driver.aadhaar_no ||
              driver.blood_group ||
              driver.alt_phone ||
              driver.dob ||
              driver.address) && (
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 pt-0.5 text-xs text-muted-foreground">
                {driver.aadhaar_no && <span>ID: {driver.aadhaar_no}</span>}
                {driver.blood_group && <span>Blood group: {driver.blood_group}</span>}
                {driver.alt_phone && <span>Alt: {driver.alt_phone}</span>}
                {driver.dob && <span>DOB: {driver.dob}</span>}
                {driver.address && <span>{driver.address}</span>}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" /> Edit
          </Button>
          <ConfirmDeleteButton
            action={softDeleteDriverAction}
            driverId={driver.driver_id}
            trigger="Delete"
            title="Delete this driver?"
            message={`${driver.name || 'This driver'} will move to Deleted Drivers and be unassigned from any bus. You can restore them later.`}
            confirmLabel="Delete driver"
            pendingText="Deleting…"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-primary/40 bg-card/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-semibold">Edit {driver.name || 'driver'}</p>
        <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => setEditing(false)}>
          <X className="size-4" /> Cancel
        </Button>
      </div>
      <form action={action} className="space-y-4">
        <input type="hidden" name="driverId" value={driver.driver_id} />
        <div className="grid gap-4 sm:grid-cols-2">
          <EditField name="name" label="Driver name" required defaultValue={driver.name} />
          <EditField name="phone" label="Phone" type="tel" defaultValue={driver.phone} />
          <EditField name="email" label="Login email" type="email" required defaultValue={driver.email} />
          <EditField name="licenseNo" label="Licence number" defaultValue={driver.license_no} />
          <EditField name="aadhaarNo" label="Aadhaar / ID card number" defaultValue={driver.aadhaar_no} />
          <EditField name="altPhone" label="Alternate / emergency contact" type="tel" defaultValue={driver.alt_phone} />
          <EditField name="dob" label="Date of birth" type="date" defaultValue={driver.dob} />
          <EditField name="bloodGroup" label="Blood group" defaultValue={driver.blood_group} />
          <EditField name="address" label="Home address" defaultValue={driver.address} />
          <div className="space-y-1.5">
            <Label htmlFor={`pw-${driver.driver_id}`}>New password (optional)</Label>
            <PasswordInput id={`pw-${driver.driver_id}`} name="password" minLength={8} autoComplete="new-password" />
            <p className="text-xs text-muted-foreground">Leave blank to keep the current password.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`active-${driver.driver_id}`}>Status</Label>
            <SelectMenu
              id={`active-${driver.driver_id}`}
              name="isActive"
              defaultValue={driver.is_active ? 'true' : 'false'}
              options={[
                { value: 'true', label: 'Active' },
                { value: 'false', label: 'Inactive (blocks login access)' },
              ]}
            />
          </div>
        </div>
        <FormStatus error={state.error} message={state.message} />
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save changes'}
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
