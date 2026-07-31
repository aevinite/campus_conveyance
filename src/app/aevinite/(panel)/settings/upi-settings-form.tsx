'use client';
import { useActionState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { saveUpiSettingsAction, type UpiSettingsState } from '@/features/admin/settings-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton } from '@/components/submit-button';

export function UpiSettingsForm({
  vpa,
  payeeName,
  active,
}: {
  vpa: string;
  payeeName: string;
  active: boolean;
}) {
  const [state, action, pending] = useActionState<UpiSettingsState, FormData>(
    saveUpiSettingsAction,
    {},
  );
  const seen = useRef<UpiSettingsState>({});

  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    if (state.error) toast.error(state.error);
    else if (state.ok) toast.success('UPI payment settings saved.');
  }, [state]);

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="vpa">UPI ID (VPA)</Label>
        <Input
          id="vpa"
          name="vpa"
          defaultValue={vpa}
          placeholder="e.g. campus@okhdfcbank"
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          Money from every booking is collected here. Families pay this via a QR / UPI app.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="payeeName">Payee name</Label>
        <Input
          id="payeeName"
          name="payeeName"
          defaultValue={payeeName}
          placeholder="Campus Conveyance"
          maxLength={80}
        />
      </div>
      <label className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/30 px-4 py-3">
        <input
          type="checkbox"
          name="active"
          defaultChecked={active}
          className="size-4 accent-[var(--primary)]"
        />
        <span className="text-sm">
          <span className="font-medium">Accept UPI payments</span>
          <span className="block text-muted-foreground">
            When off, the payment screen tells riders payments aren&apos;t set up yet.
          </span>
        </span>
      </label>
      <SubmitButton pendingText="Saving…" disabled={pending}>
        Save UPI settings
      </SubmitButton>
    </form>
  );
}
