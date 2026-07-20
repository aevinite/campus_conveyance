'use client';
import { useActionState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { KeyRound } from 'lucide-react';
import { redeemParentCodeAction, type LinkChildState } from '@/features/parent/actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton } from '@/components/submit-button';

/**
 * Linking works with a one-time 6-digit code the child generates from their
 * student profile (Profile → Parent access). Codes expire after 3 minutes.
 */
export function LinkChildForm() {
  const [state, action, pending] = useActionState<LinkChildState, FormData>(
    redeemParentCodeAction,
    {},
  );
  const seen = useRef<LinkChildState>({});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    if (state.error) toast.error(state.error);
    else if (state.ok) {
      const who = state.childName ?? 'This child';
      if (state.alreadyLinked) {
        // Nothing changed — they were already linked; don't imply a new link.
        toast.info(`${who} is already linked to your account.`);
      } else {
        toast.success(
          state.childName ? `${state.childName} linked to your account.` : 'Child linked.',
        );
      }
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-xs">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
          <KeyRound className="size-5" />
        </span>
        <div>
          <h2 className="font-semibold">Link your child</h2>
          <p className="text-sm text-muted-foreground">
            Ask your child to open <b>Profile → Parent access</b> in their student
            account and generate a code, then enter it here within 3 minutes.
          </p>
        </div>
      </div>
      <form ref={formRef} action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5 sm:max-w-52">
          <Label htmlFor="code">6-digit code</Label>
          <Input
            id="code"
            name="code"
            required
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            placeholder="••••••"
            autoComplete="one-time-code"
            className="text-center text-lg font-semibold tracking-[0.4em]"
          />
        </div>
        <SubmitButton pendingText="Linking…" disabled={pending}>
          Link child
        </SubmitButton>
      </form>
    </div>
  );
}
