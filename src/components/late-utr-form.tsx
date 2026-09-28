'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2 } from 'lucide-react';
import { submitUpiPaymentAction } from '@/features/booking/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * "Already paid?" — lets a rider whose 10-minute payment window closed while
 * they were paying still hand in the UPI reference (UTR). The booking stays
 * cancelled (the seat may already be resold); the admin verifies the money and
 * refunds it. Accepted by submit_upi_payment for up to 24h after the hold lapsed.
 */
export function LateUtrForm({
  bookingId,
  studentId,
  className = '',
}: {
  bookingId: string;
  /** Parent flow: the child the booking belongs to. */
  studentId?: string;
  className?: string;
}) {
  const [utr, setUtr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit() {
    if (busy) return;
    const clean = utr.trim();
    if (!/^\d{12}$/.test(clean)) {
      toast.error('Enter the 12-digit UPI reference (UTR) from your UPI app.');
      return;
    }
    setBusy(true);
    const fd = new FormData();
    fd.set('bookingId', bookingId);
    fd.set('utr', clean);
    if (studentId) fd.set('studentId', studentId);
    const res = await submitUpiPaymentAction({}, fd);
    setBusy(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div
        className={`flex items-start gap-2.5 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success ${className}`}
      >
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
        <span>Thanks — we&apos;ll verify it and refund you, since the seat hold had expired.</span>
      </div>
    );
  }

  return (
    <div className={`space-y-2 rounded-lg border border-border bg-muted/40 px-3 py-3 ${className}`}>
      <p className="text-sm font-medium">Already paid? Enter your 12-digit UTR</p>
      <p className="text-xs text-muted-foreground">
        If the money left your account just as the window closed, send us the reference and we&apos;ll
        refund it once verified.
      </p>
      <div className="flex gap-2">
        <Input
          value={utr}
          onChange={(e) => setUtr(e.target.value.replace(/\D/g, '').slice(0, 12))}
          inputMode="numeric"
          placeholder="12-digit UTR"
          aria-label="UPI reference (UTR)"
          className="font-mono"
        />
        <Button type="button" variant="outline" onClick={onSubmit} disabled={busy}>
          {busy ? 'Sending…' : 'Submit'}
        </Button>
      </div>
    </div>
  );
}
