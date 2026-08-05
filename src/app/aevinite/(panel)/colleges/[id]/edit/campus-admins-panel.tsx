'use client';
import { useActionState } from 'react';
import { UserPlus } from 'lucide-react';
import type { FormState } from '@/features/admin/actions';
import {
  createInstitutionAdminAction,
  unlinkInstitutionAdminAction,
} from '@/features/admin/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormStatus } from '@/components/form-status';
import { SubmitButton } from '@/components/submit-button';

export interface CampusAdmin {
  id: string;
  name: string | null;
  email: string | null;
}

/**
 * SUPER_ADMIN panel on the college edit page: create a campus-admin login linked
 * to this college, and unlink existing ones. The linked admin then runs the
 * /institution oversight console for this campus.
 */
export function CampusAdminsPanel({
  collegeId,
  admins,
}: {
  collegeId: string;
  admins: CampusAdmin[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createInstitutionAdminAction,
    {},
  );

  return (
    <div className="space-y-5">
      {admins.length > 0 ? (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {admins.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{a.name ?? '—'}</p>
                <p className="truncate text-xs text-muted-foreground">{a.email ?? '—'}</p>
              </div>
              <form action={unlinkInstitutionAdminAction}>
                <input type="hidden" name="profileId" value={a.id} />
                <input type="hidden" name="collegeId" value={collegeId} />
                <SubmitButton size="sm" variant="outline" pendingText="Unlinking…">
                  Unlink
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No campus admin linked yet. Create one below to give this campus its own oversight console.
        </p>
      )}

      <form action={formAction} className="space-y-4 rounded-xl border border-border bg-muted/30 p-4">
        <input type="hidden" name="collegeId" value={collegeId} />
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <UserPlus className="size-4 text-primary" /> Add a campus admin
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ca-name">Full name</Label>
            <Input id="ca-name" name="name" defaultValue="" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ca-email">Email</Label>
            <Input id="ca-email" name="email" type="email" defaultValue="" required />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ca-password">Temporary password</Label>
          <Input id="ca-password" name="password" type="text" minLength={8} defaultValue="" required />
          <p className="text-xs text-muted-foreground">
            At least 8 characters. Share it with the admin — they sign in at the admin login.
          </p>
        </div>
        <FormStatus error={state.error} message={state.message} />
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? 'Creating…' : 'Create campus admin'}
        </Button>
      </form>
    </div>
  );
}
