'use client';
import { useActionState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { setChildCampusAction, type ChildCampusState } from '@/features/parent/actions';
import { SelectMenu } from '@/components/ui/select-menu';
import { SubmitButton } from '@/components/submit-button';
import type { CampusOption } from '../../add-child-form';

/** Pick the campus for a linked child who has none yet, so booking can start. */
export function ChildCampusForm({
  studentId,
  childName,
  campuses,
}: {
  studentId: string;
  childName: string;
  campuses: CampusOption[];
}) {
  const [state, action] = useActionState<ChildCampusState, FormData>(setChildCampusAction, {});
  const seen = useRef<ChildCampusState>({});
  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form
      action={action}
      className="space-y-3 rounded-2xl border border-dashed border-border p-6 text-sm"
    >
      <input type="hidden" name="studentId" value={studentId} />
      <p className="font-medium">Which campus does {childName} go to?</p>
      <p className="text-muted-foreground">
        Choose it once — you&apos;ll then see the agencies that run buses and vans there.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SelectMenu
          name="institutionId"
          options={campuses}
          placeholder="Select a campus…"
          searchable
          searchPlaceholder="Search campuses…"
          ariaLabel="Campus"
          className="sm:w-80"
        />
        <SubmitButton pendingText="Saving…">Continue</SubmitButton>
      </div>
    </form>
  );
}
