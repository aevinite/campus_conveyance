'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Pencil } from 'lucide-react';
import { editManagedChildAction, type ManagedChildState } from '@/features/parent/actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton } from '@/components/submit-button';

export type EditableChild = {
  studentId: string;
  fullName: string;
  phone: string;
  grade: string;
  address: string;
  rollNo: string;
  email: string;
};

/**
 * Edit a managed child's details (a child with no login of their own — the
 * parent owns these fields). Inputs are controlled so React 19's automatic
 * <form action> reset can't blank what the parent typed, on success or error.
 */
export function EditChildForm({ child }: { child: EditableChild }) {
  const [state, action, pending] = useActionState<ManagedChildState, FormData>(
    editManagedChildAction,
    {},
  );
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(child);
  const seen = useRef<ManagedChildState>({});

  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    if (state.error) toast.error(state.error);
    else if (state.ok) {
      toast.success(`${state.childName ?? 'Child'}’s details saved.`);
      // Reacting to a completed useActionState result (guarded by `seen`).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
    }
  }, [state]);

  const field = (k: keyof EditableChild) => ({
    value: v[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV((p) => ({ ...p, [k]: e.target.value })),
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setV(child); // start from the latest saved values
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold transition-colors hover:border-primary/50 hover:text-primary"
      >
        <Pencil className="size-4" /> Edit details
      </button>
    );
  }

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="studentId" value={child.studentId} />
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="edit-fullName">Child&apos;s full name</Label>
        <Input id="edit-fullName" name="fullName" required maxLength={120} {...field('fullName')} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edit-phone">Contact phone</Label>
        <Input id="edit-phone" name="phone" required inputMode="tel" maxLength={20} {...field('phone')} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edit-grade">Class / grade <span className="text-muted-foreground">(optional)</span></Label>
        <Input id="edit-grade" name="grade" maxLength={40} {...field('grade')} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="edit-address">Pickup address</Label>
        <Input id="edit-address" name="address" required maxLength={300} {...field('address')} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edit-rollNo">Roll no <span className="text-muted-foreground">(optional)</span></Label>
        <Input id="edit-rollNo" name="rollNo" maxLength={40} {...field('rollNo')} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edit-email">Email <span className="text-muted-foreground">(optional)</span></Label>
        <Input id="edit-email" name="email" type="email" maxLength={160} {...field('email')} />
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <SubmitButton pendingText="Saving…" disabled={pending}>
          Save details
        </SubmitButton>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-muted"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
