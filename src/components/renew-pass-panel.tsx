'use client';
import { useActionState, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowLeft, CalendarClock, CheckCircle2, Clock3, Copy, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';
import { submitPassRenewalAction, type RenewState } from '@/features/booking/renewal-actions';
import { isNativeApp } from '@/lib/native-google-auth';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton } from '@/components/submit-button';
import { BILLING_PERIODS, type BillingPeriod } from '@/lib/billing';
import { formatDateMedium } from '@/lib/format-date';

export interface RenewInfo {
  bookingId: string;
  studentName: string | null;
  routeName: string;
  currentPeriod: BillingPeriod | null;
  passEnd: string | null;
  canRenew: boolean;
  reason: string | null;
  pendingPeriod: BillingPeriod | null;
  pendingUtr: string | null;
  reference: string;
  prices: Record<BillingPeriod, number | null>;
}

const inr = (cents: number) => `₹${Math.round(cents / 100).toLocaleString('en-IN')}`;

/**
 * Renew a bus pass IN PLACE: pick the next plan, pay the platform UPI account,
 * enter the UTR. The admin verifies it and the same booking's pass is extended
 * from its current end date — the seat is never released.
 */
export function RenewPassPanel({
  info,
  upi,
  backHref,
  whoLabel,
}: {
  info: RenewInfo;
  upi: { vpa: string; payee: string; configured: boolean };
  backHref: string;
  whoLabel?: string;
}) {
  const offered = BILLING_PERIODS.filter((p) => (info.prices[p.period] ?? 0) > 0);
  const [period, setPeriod] = useState<BillingPeriod | null>(
    info.pendingPeriod ??
      (offered.some((p) => p.period === info.currentPeriod) ? info.currentPeriod : offered[0]?.period ?? null),
  );
  // Controlled so React 19's automatic <form action> reset can't wipe the UTR.
  const [utr, setUtr] = useState(info.pendingUtr ?? '');
  const [isApp, setIsApp] = useState(false);
  // Client-only UA probe (same one-shot as the reserve form's pay panel).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setIsApp(isNativeApp()), []);
  const [state, formAction] = useActionState<RenewState, FormData>(submitPassRenewalAction, {});
  const submitted = state.ok || (!!info.pendingUtr && !state.error);

  const cents = period ? info.prices[period] ?? 0 : 0;
  const upiString = useMemo(() => {
    if (!upi.configured || !upi.vpa || !cents) return null;
    const p = new URLSearchParams({
      pa: upi.vpa,
      pn: upi.payee || 'Campus Conveyance',
      am: String(Math.round(cents / 100)),
      cu: 'INR',
      tn: `Campus Conveyance ${info.reference}`,
      tr: info.reference,
    });
    return `upi://pay?${p.toString()}`;
  }, [upi, cents, info.reference]);

  async function openUpiApp() {
    if (!upiString) return;
    try {
      const { AppLauncher } = await import('@capacitor/app-launcher');
      await AppLauncher.openUrl({ url: upiString });
    } catch {
      toast.error('No UPI app found. Scan the QR or copy the UPI ID to pay.');
    }
  }

  const title = whoLabel ? `Renew ${whoLabel}'s bus pass` : 'Renew your bus pass';

  return (
    <section className="mx-auto w-full max-w-2xl space-y-5">
      <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        <p className="mt-1 text-muted-foreground">
          {info.routeName}
          {info.passEnd && (
            <>
              {' · '}
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="size-3.5" /> current pass ends {formatDateMedium(info.passEnd)}
              </span>
            </>
          )}
        </p>
      </div>

      {submitted ? (
        <div className="flex items-start gap-2.5 rounded-2xl border border-success/30 bg-success/10 p-4 text-sm text-success">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <span>
            Renewal payment submitted — we&apos;re verifying it. Your seat stays yours, and the new plan starts
            when the current one ends. We&apos;ll notify you once it&apos;s confirmed.
          </span>
        </div>
      ) : !info.canRenew ? (
        <div className="flex items-start gap-2.5 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          <Clock3 className="mt-0.5 size-4 shrink-0" />
          <span>{info.reason ?? 'This pass can’t be renewed right now.'}</span>
        </div>
      ) : offered.length === 0 ? (
        <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          This route has no plans on sale right now. Please contact support.
        </div>
      ) : !upi.configured ? (
        <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          Online payments aren&apos;t set up yet. Please try again shortly or contact support.
        </div>
      ) : (
        <div className="space-y-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div>
            <p className="mb-2 text-sm font-semibold">1. Pick your next plan</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {offered.map((p) => {
                const on = p.period === period;
                return (
                  <button
                    key={p.period}
                    type="button"
                    onClick={() => setPeriod(p.period)}
                    className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                      on ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'
                    }`}
                  >
                    <p className="text-sm font-semibold">{p.label}</p>
                    <p className="tnum text-lg font-bold text-primary">
                      {inr(info.prices[p.period] ?? 0)}
                      <span className="text-xs font-medium text-muted-foreground">{p.suffix}</span>
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-background p-5">
              <p className="self-start text-sm font-semibold">2. Pay {cents ? inr(cents) : ''} by UPI</p>
              {upiString && (
                <div className="rounded-xl bg-white p-3">
                  <QRCodeSVG value={upiString} size={170} includeMargin={false} />
                </div>
              )}
              <div className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                <span className="truncate font-mono text-sm font-medium">{upi.vpa}</span>
                <button
                  type="button"
                  onClick={() =>
                    navigator.clipboard?.writeText(upi.vpa).then(
                      () => toast.success('UPI ID copied.'),
                      () => toast.error('Could not copy — long-press to copy it.'),
                    )
                  }
                  className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10"
                >
                  <Copy className="size-3.5" /> Copy
                </button>
              </div>
              {upiString &&
                (isApp ? (
                  <button
                    type="button"
                    onClick={openUpiApp}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                  >
                    <Smartphone className="size-4" /> Open a UPI app to pay
                  </button>
                ) : (
                  <a
                    href={upiString}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                  >
                    <Smartphone className="size-4" /> Open a UPI app to pay
                  </a>
                ))}
              <p className="text-xs text-muted-foreground">Reference: {info.reference}</p>
            </div>

            <form action={formAction} className="space-y-3">
              <input type="hidden" name="bookingId" value={info.bookingId} />
              <input type="hidden" name="period" value={period ?? ''} />
              <Label htmlFor="renew-utr">3. Enter your UPI reference (UTR)</Label>
              <Input
                id="renew-utr"
                name="utr"
                inputMode="numeric"
                maxLength={12}
                value={utr}
                onChange={(e) => setUtr(e.target.value.replace(/\D/g, ''))}
                placeholder="12-digit reference from your UPI app"
                className="text-center text-lg font-semibold tracking-[0.2em]"
              />
              {state.error && <p className="text-sm text-destructive">{state.error}</p>}
              <SubmitButton className="w-full" pendingText="Submitting…">
                <RefreshCw className="size-4" /> I&apos;ve paid — renew pass
              </SubmitButton>
              <p className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5 shrink-0" /> Your pass is extended once we verify the payment.
              </p>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
