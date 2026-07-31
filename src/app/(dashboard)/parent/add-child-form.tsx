'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import { addManagedChildAction, type ManagedChildState } from '@/features/parent/actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectMenu } from '@/components/ui/select-menu';
import { SubmitButton } from '@/components/submit-button';

export type CampusOption = { value: string; label: string };

/**
 * Add a child who has no login of their own (a "managed" child). The parent
 * fills the child's details once; after that they can book a bus/van for the
 * child from the dashboard. Children with their own student account are linked
 * with a 6-digit code instead (see LinkChildForm).
 */
export function AddChildForm({ campuses }: { campuses: CampusOption[] }) {
  const [state, action, pending] = useActionState<ManagedChildState, FormData>(
    addManagedChildAction,
    {},
  );
  const [open, setOpen] = useState(false);
  const seen = useRef<ManagedChildState>({});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    if (state.error) toast.error(state.error);
    else if (state.ok) {
      toast.success(`${state.childName ?? 'Child'} added — you can book a bus for them now.`);
      formRef.current?.reset(); // SelectMenu resets its own value on the form reset
      setOpen(false);
    }
  }, [state]);

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
            <UserPlus className="size-5" />
          </span>
          <div>
            <h2 className="font-semibold">Add a child</h2>
            <p className="text-sm text-muted-foreground">
              Add a child who doesn&apos;t have their own login — you&apos;ll book and
              track their bus from here.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold transition-colors hover:border-primary/50 hover:text-primary"
        >
          {open ? 'Cancel' : 'Add a child'}
        </button>
      </div>

      {open && (
        <form ref={formRef} action={action} className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="fullName">Child&apos;s full name</Label>
            <Input id="fullName" name="fullName" required maxLength={120} placeholder="e.g. Aarav Sharma" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Campus (school / college)</Label>
            <SelectMenu
              name="institutionId"
              searchable
              placeholder="Select the child's campus"
              searchPlaceholder="Search campuses…"
              options={campuses}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Contact phone</Label>
            <Input id="phone" name="phone" required inputMode="tel" maxLength={20} placeholder="Guardian / child phone" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="grade">Class / grade <span className="text-muted-foreground">(optional)</span></Label>
            <Input id="grade" name="grade" maxLength={40} placeholder="e.g. 6th" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="address">Pickup address</Label>
            <Input id="address" name="address" required maxLength={300} placeholder="Home address for pickup" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rollNo">Roll no <span className="text-muted-foreground">(optional)</span></Label>
            <Input id="rollNo" name="rollNo" maxLength={40} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email <span className="text-muted-foreground">(optional)</span></Label>
            <Input id="email" name="email" type="email" maxLength={160} placeholder="For ride updates" />
          </div>
          <div className="sm:col-span-2">
            <SubmitButton pendingText="Adding…" disabled={pending}>
              Add child
            </SubmitButton>
          </div>
        </form>
      )}
    </div>
  );
}
