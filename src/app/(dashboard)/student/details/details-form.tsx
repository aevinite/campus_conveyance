'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { UserRound } from 'lucide-react';
import { saveStudentDetailsAction, type DetailsState } from '@/features/booking/actions';
import type { StudentDetails } from '@/features/booking/services';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton } from '@/components/submit-button';

export function DetailsForm({ details, next }: { details: StudentDetails; next: string }) {
  const router = useRouter();
  const [form, setForm] = useState<StudentDetails>(details);
  const [state, action, pending] = useActionState<DetailsState, FormData>(
    saveStudentDetailsAction,
    {},
  );
  const seen = useRef<DetailsState>({});

  const set =
    (k: keyof StudentDetails) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    if (state.error) toast.error(state.error);
    else if (state.ok) {
      toast.success('Details saved.');
      router.push(next);
    }
  }, [state, next, router]);

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-xs">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
          <UserRound className="size-5" />
        </span>
        <div>
          <h2 className="font-semibold">Student details</h2>
          <p className="text-sm text-muted-foreground">
            Name, phone and address are required.
          </p>
        </div>
      </div>

      <form action={action} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="fullName">Full name</Label>
            <Input id="fullName" name="fullName" value={form.fullName} onChange={set('fullName')} required minLength={2} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" type="tel" value={form.phone} onChange={set('phone')} required placeholder="e.g. +91 90000 00000" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="address">Address</Label>
          <textarea
            id="address"
            name="address"
            rows={2}
            value={form.address}
            onChange={set('address')}
            required
            placeholder="House / street / area, city"
            className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-2xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 dark:bg-input/30"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="grade">Class / Year</Label>
            <Input id="grade" name="grade" value={form.grade} onChange={set('grade')} placeholder="e.g. FY B.Tech" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="guardianName">Guardian name</Label>
            <Input id="guardianName" name="guardianName" value={form.guardianName} onChange={set('guardianName')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="guardianPhone">Guardian phone</Label>
            <Input id="guardianPhone" name="guardianPhone" type="tel" value={form.guardianPhone} onChange={set('guardianPhone')} />
          </div>
        </div>

        {state.error && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {state.error}
          </p>
        )}

        <SubmitButton className="w-full sm:w-auto" pendingText="Saving…" disabled={pending}>
          Save &amp; continue
        </SubmitButton>
      </form>
    </div>
  );
}
