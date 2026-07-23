'use client';
import { useActionState, useEffect, useState } from 'react';
import { UserPlus, RefreshCw, Clock3 } from 'lucide-react';
import { createParentCodeAction, type ParentCodeState } from '@/features/parent/actions';
import { SubmitButton } from '@/components/submit-button';

/**
 * "Parent access": the student generates a 6-digit code; their parent enters
 * it on the parent dashboard within 3 minutes to link the two accounts.
 */
export function ParentAccessCard() {
  const [state, action, pending] = useActionState<ParentCodeState, FormData>(
    createParentCodeAction,
    {},
  );
  // Tick once a second ONLY while a code is counting down — no code (or an
  // expired one) means no reason to keep an interval running forever.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!state.expiresAt) return;
    const deadline = new Date(state.expiresAt).getTime();
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= deadline) clearInterval(t); // self-stop once it lapses
    }, 1000);
    return () => clearInterval(t);
  }, [state.expiresAt]);

  const expiresAt = state.expiresAt ? new Date(state.expiresAt).getTime() : null;
  const secondsLeft = expiresAt ? Math.max(0, Math.floor((expiresAt - now) / 1000)) : 0;
  const live = Boolean(state.code) && secondsLeft > 0;
  const mmss = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Generate a one-time code and have your parent enter it on their Campus
        Conveyance parent dashboard. The code works for <b>3 minutes</b> and
        links their account to yours — they&apos;ll see your bookings, bus and
        driver details.
      </p>

      {live ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-primary/30 bg-primary/[0.06] p-5 text-center">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Your parent code
            </p>
            <p className="mt-2 font-heading text-4xl font-bold tracking-[0.35em] text-primary">
              {state.code}
            </p>
            <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-warning">
              <Clock3 className="size-4" /> Expires in {mmss}
            </p>
          </div>
          <form action={action}>
            <SubmitButton variant="outline" size="sm" pendingText="Generating…" disabled={pending}>
              <RefreshCw className="size-4" /> Generate a new code
            </SubmitButton>
          </form>
        </div>
      ) : (
        <div className="space-y-2">
          {state.code && !live && (
            <p className="text-sm text-warning">
              That code expired — generate a new one when your parent is ready.
            </p>
          )}
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <form action={action}>
            <SubmitButton pendingText="Generating…" disabled={pending}>
              <UserPlus className="size-4" /> Generate parent code
            </SubmitButton>
          </form>
        </div>
      )}
    </div>
  );
}
