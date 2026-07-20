'use client';
import { useActionState, useEffect, useRef } from 'react';
import { createDriverAction, type FormState } from '@/features/agency/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/auth/password-input';
import { Label } from '@/components/ui/label';
import { FormStatus } from '@/components/form-status';

function Field({
  name,
  label,
  type = 'text',
  required = false,
  placeholder,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} required={required} placeholder={placeholder} autoComplete="off" />
    </div>
  );
}

export function DriverForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createDriverAction, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.message) formRef.current?.reset();
    // Whole state object (new each dispatch) so identical messages still re-fire.
  }, [state]);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="name" label="Driver name" required />
        <Field name="phone" label="Phone" type="tel" required placeholder="e.g. +91 90000 00000" />
        <Field name="email" label="Login email" type="email" required placeholder="driver@example.com" />
        <div className="space-y-1.5">
          <Label htmlFor="password">Login password</Label>
          <PasswordInput id="password" name="password" minLength={8} required autoComplete="new-password" />
          <p className="text-xs text-muted-foreground">At least 8 characters. Share this with the driver.</p>
        </div>
        <Field name="licenseNo" label="Licence number" required placeholder="e.g. GJ0120210001234" />
        <Field name="aadhaarNo" label="Aadhaar / ID card number" required placeholder="e.g. XXXX XXXX 1234" />
        <Field name="altPhone" label="Alternate / emergency contact" type="tel" required />
        <Field name="address" label="Home address" required placeholder="House, street, city" />
        <Field name="dob" label="Date of birth (optional)" type="date" />
        <Field name="bloodGroup" label="Blood group (optional)" placeholder="e.g. O+" />
      </div>
      <p className="text-xs text-muted-foreground">
        These details form the driver&apos;s safety record and are shown to students and parents when this
        driver is on their bus.
      </p>
      <FormStatus error={state.error} message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create driver account'}
      </Button>
    </form>
  );
}
