'use client';
import { useActionState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import { linkChildAction, type LinkChildState } from '@/features/parent/actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton } from '@/components/submit-button';

export function LinkChildForm() {
  const [state, action, pending] = useActionState<LinkChildState, FormData>(
    linkChildAction,
    {},
  );
  const seen = useRef<LinkChildState>({});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    if (state.error) toast.error(state.error);
    else if (state.ok) {
      toast.success(
        state.childName ? `${state.childName} linked to your account.` : 'Child linked.',
      );
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-xs">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
          <UserPlus className="size-5" />
        </span>
        <div>
          <h2 className="font-semibold">Link your child</h2>
          <p className="text-sm text-muted-foreground">
            Enter the email your child uses to sign in to Campus Conveyance.
          </p>
        </div>
      </div>
      <form ref={formRef} action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="email">Child&apos;s account email</Label>
          <Input id="email" name="email" type="email" required placeholder="student@email.com" />
        </div>
        <SubmitButton pendingText="Linking…" disabled={pending}>
          Link child
        </SubmitButton>
      </form>
    </div>
  );
}
