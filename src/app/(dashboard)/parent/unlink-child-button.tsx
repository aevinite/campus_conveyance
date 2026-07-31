'use client';
import { useActionState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { unlinkChildAction, type UnlinkChildState } from '@/features/parent/actions';

export function UnlinkChildButton({
  studentId,
  managed = false,
}: {
  studentId: string;
  /** A managed child (no login) is fully removed; a linked one is just unlinked. */
  managed?: boolean;
}) {
  const [state, action, pending] = useActionState<UnlinkChildState, FormData>(
    unlinkChildAction,
    {},
  );
  const seen = useRef<UnlinkChildState>({});

  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    if (state.error) toast.error(state.error);
    else if (state.ok) toast.success(managed ? 'Child removed.' : 'Child unlinked.');
  }, [state, managed]);

  return (
    <form action={action}>
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="managed" value={String(managed)} />
      <button
        type="submit"
        disabled={pending}
        className="text-sm font-medium text-muted-foreground transition-colors hover:text-destructive disabled:opacity-60"
      >
        {pending ? 'Removing…' : managed ? 'Remove' : 'Unlink'}
      </button>
    </form>
  );
}
