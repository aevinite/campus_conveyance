'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { changePasswordAction, type AuthState } from '@/features/auth/actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton } from '@/components/submit-button';

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(changePasswordAction, {});
  const [show, setShow] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the fields after a successful change so passwords don't linger.
  useEffect(() => {
    if (state.message) formRef.current?.reset();
    // Whole state object (new each dispatch) so identical messages still re-fire.
  }, [state]);

  const type = show ? 'text' : 'password';
  return (
    <form ref={formRef} action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="currentPassword">Current password</Label>
        <Input id="currentPassword" name="currentPassword" type={type} autoComplete="current-password" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="newPassword">New password</Label>
        <Input id="newPassword" name="newPassword" type={type} autoComplete="new-password" minLength={8} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <Input id="confirmPassword" name="confirmPassword" type={type} autoComplete="new-password" minLength={8} required />
      </div>

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="inline-flex items-center gap-1.5 hover:text-foreground"
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          {show ? 'Hide passwords' : 'Show passwords'}
        </button>
      </label>

      {state.error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          {state.message}
        </p>
      )}

      <SubmitButton className="w-full" pendingText="Updating…" disabled={pending}>
        Update password
      </SubmitButton>
    </form>
  );
}
