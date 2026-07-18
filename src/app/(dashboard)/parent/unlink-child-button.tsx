'use client';
import { useActionState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { unlinkChildAction, type UnlinkChildState } from '@/features/parent/actions';

export function UnlinkChildButton({ studentId }: { studentId: string }) {
  const [state, action, pending] = useActionState<UnlinkChildState, FormData>(
    unlinkChildAction,
    {},
  );
  const seen = useRef<UnlinkChildState>({});

  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    if (state.error) toast.error(state.error);
    else if (state.ok) toast.success('Child unlinked.');
  }, [state]);

  return (
    <form action={action}>
      <input type="hidden" name="studentId" value={studentId} />
      <button
        type="submit"
        disabled={pending}
        className="text-sm font-medium text-muted-foreground transition-colors hover:text-destructive disabled:opacity-60"
      >
        {pending ? 'Removing…' : 'Unlink'}
      </button>
    </form>
  );
}
