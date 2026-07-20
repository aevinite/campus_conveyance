'use client';
import { useActionState, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { UserCog, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { changeBusDriverAction, revertBusDriverAction, type FormState } from '@/features/agency/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectMenu } from '@/components/ui/select-menu';
import { SubmitButton } from '@/components/submit-button';

/**
 * Swap the driver OR conductor of a bus for today. `role` picks which one; the
 * substitute is chosen from the agency's registered, unassigned drivers.
 */
export function DriverChangePanel({
  busId,
  role,
  todayId,
  todayName,
  todayPhone,
  todayReason,
  regularName,
  drivers = [],
}: {
  busId: string;
  role: 'DRIVER' | 'CONDUCTOR';
  /** Current substitute's driver id, to preselect it when editing. */
  todayId?: string | null;
  todayName: string | null;
  todayPhone: string | null;
  todayReason: string | null;
  regularName: string | null;
  drivers?: { id: string; name: string; phone: string | null }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [changeState, changeAction] = useActionState<FormState, FormData>(changeBusDriverAction, {});
  const [revertState, revertAction] = useActionState<FormState, FormData>(revertBusDriverAction, {});

  useEffect(() => {
    if (changeState.message) {
      toast.success(changeState.message);
      setOpen(false);
      router.refresh();
    } else if (changeState.error) {
      toast.error(changeState.error);
    }
  }, [changeState, router]);

  useEffect(() => {
    if (revertState.message) {
      toast.success(revertState.message);
      router.refresh();
    } else if (revertState.error) {
      toast.error(revertState.error);
    }
  }, [revertState, router]);

  const noun = role === 'CONDUCTOR' ? 'conductor' : 'driver';
  const active = Boolean(todayName);
  const uid = `${role}-${busId}`;

  return (
    <div className="mt-3 rounded-xl border border-border bg-muted/20 p-3">
      {active ? (
        <div className="space-y-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning">
            <UserCog className="size-3.5" /> {noun === 'driver' ? 'Driver' : 'Conductor'} changed for today
          </span>
          <p className="text-sm">
            Today&apos;s {noun}: <span className="font-medium">{todayName}</span>
            {todayPhone ? ` · ${todayPhone}` : ''}
          </p>
          {todayReason && <p className="text-xs text-muted-foreground">Reason: {todayReason}</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
              {open ? 'Cancel' : `Edit today’s ${noun}`}
            </Button>
            <form action={revertAction}>
              <input type="hidden" name="busId" value={busId} />
              <input type="hidden" name="role" value={role} />
              <SubmitButton variant="ghost" size="sm" pendingText="Reverting…" className="gap-1.5">
                <RotateCcw className="size-3.5" /> Revert to regular {noun}
              </SubmitButton>
            </form>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Regular {noun}{regularName ? `: ${regularName}` : ''} is on duty today.
          </p>
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen((v) => !v)}>
            <UserCog className="size-3.5" /> {open ? 'Cancel' : `Change ${noun} for today`}
          </Button>
        </div>
      )}

      {open &&
        (drivers.length === 0 ? (
          <div className="mt-3 space-y-2 border-t border-border pt-3 text-sm text-muted-foreground">
            <p>
              No unassigned staff available. A substitute must be one of your registered drivers who
              isn&apos;t already assigned to a bus.
            </p>
            <Link
              href="/agency/drivers"
              className="inline-block font-medium text-primary transition-colors hover:text-primary/70"
            >
              Add or free up a driver in Manage Drivers →
            </Link>
          </div>
        ) : (
          <form action={changeAction} className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
            <input type="hidden" name="busId" value={busId} />
            <input type="hidden" name="role" value={role} />
            <div className="space-y-1.5">
              <Label htmlFor={`dc-driver-${uid}`}>Substitute {noun}</Label>
              <SelectMenu
                id={`dc-driver-${uid}`}
                name="driverId"
                defaultValue={todayId ?? ''}
                placeholder="Select a registered driver"
                options={drivers.map((d) => ({
                  value: d.id,
                  label: d.phone ? `${d.name} · ${d.phone}` : d.name,
                }))}
              />
              <p className="text-xs text-muted-foreground">
                Only your registered drivers not assigned to a bus appear here.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`dc-reason-${uid}`}>Reason (optional)</Label>
              <Input
                id={`dc-reason-${uid}`}
                name="reason"
                defaultValue={todayReason ?? ''}
                placeholder={`e.g. regular ${noun} on leave`}
              />
            </div>
            <div className="sm:col-span-2">
              <SubmitButton size="sm" pendingText="Saving…">Save today’s {noun}</SubmitButton>
            </div>
          </form>
        ))}
    </div>
  );
}
