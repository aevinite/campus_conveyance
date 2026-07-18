'use client';
import { useActionState, useState } from 'react';
import { updateProfileAction, type AuthState } from '@/features/auth/actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton } from '@/components/submit-button';

export function EditProfileForm({
  fullName,
  phone,
  email,
}: {
  fullName: string;
  phone: string;
  email: string;
}) {
  const [state, action, pending] = useActionState<AuthState, FormData>(updateProfileAction, {});
  // Controlled fields: after a successful save the server re-renders with new
  // values, and Base UI warns if an *uncontrolled* field's default changes after
  // init. Controlling them keeps our own state and avoids that warning.
  const [name, setName] = useState(fullName);
  const [tel, setTel] = useState(phone);

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="fullName">Full name</Label>
        <Input
          id="fullName"
          name="fullName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="phone">Phone</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          value={tel}
          onChange={(e) => setTel(e.target.value)}
          placeholder="e.g. +91 90000 00000"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="emailRO">Email address</Label>
        <Input id="emailRO" value={email} readOnly disabled />
        <p className="text-xs text-muted-foreground">Email can&apos;t be changed here.</p>
      </div>

      {state.error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.message && (
        <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          {state.message}
        </p>
      )}

      <SubmitButton pendingText="Saving…" disabled={pending}>
        Save changes
      </SubmitButton>
    </form>
  );
}
