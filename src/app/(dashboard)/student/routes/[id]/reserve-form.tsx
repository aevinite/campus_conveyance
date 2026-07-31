'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { QRCodeSVG } from 'qrcode.react';
import { useModalFocusTrap } from '@/lib/use-modal-focus-trap';
import { formatTime } from '@/lib/format-date';
import {
  MapPin,
  GraduationCap,
  CheckCircle2,
  Clock3,
  ArrowRight,
  Smartphone,
  Copy,
  ShieldCheck,
  Loader2,
  X,
} from 'lucide-react';
import { reserveSeatAction, submitUpiPaymentAction } from '@/features/booking/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectMenu } from '@/components/ui/select-menu';
import type { Stop } from '@/features/booking/repository';
import { PaymentCountdown } from './payment-countdown';

// The auto-approval runs server-side inside reserve_seat (seat availability,
// pickup validity and campus eligibility are all checked there). This is the
// on-screen "Approving your request…" pause — kept well under 30 seconds.
const APPROVAL_MS = 4000;

const CHECKS = ['Seat availability', 'Your pickup stop', 'Campus eligibility'];

type Phase = 'reserve' | 'approving' | 'payment' | 'submitted' | 'waitlisted' | 'expired';

function fmtIST(iso: string | null): string | null {
  return iso ? formatTime(iso) : null;
}

/** The platform UPI account to pay into (from admin settings). */
export type UpiConfig = { vpa: string; payee: string; configured: boolean };

// Deterministic payment reference — MUST match submit_upi_payment's
// 'CC' || upper(left(replace(id,'-',''),12)) so the admin sees the same ref.
function refFor(bookingId: string): string {
  return 'CC' + bookingId.replace(/-/g, '').slice(0, 12).toUpperCase();
}
function buildUpiString(
  vpa: string,
  payee: string,
  amountRupees: string,
  reference: string,
): string {
  const p = new URLSearchParams({
    pa: vpa,
    pn: payee || 'Campus Conveyance',
    am: amountRupees,
    cu: 'INR',
    tn: `Campus Conveyance ${reference}`,
    tr: reference,
  });
  return `upi://pay?${p.toString()}`;
}

function PanelSteps({ active }: { active: 1 | 2 | 3 }) {
  const steps = ['Request', 'Approval', 'Payment'];
  return (
    <ol className="mb-4 flex items-center gap-1.5 text-xs">
      {steps.map((s, i) => {
        const n = i + 1;
        const on = n <= active;
        return (
          <li key={s} className="flex flex-1 flex-col gap-1">
            <span className={`h-1 rounded-full ${on ? 'bg-primary' : 'bg-border'}`} />
            <span className={on ? 'font-medium text-foreground' : 'text-muted-foreground'}>
              {n}. {s}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export type PlanOption = {
  period: 'MONTHLY' | 'SEMESTER' | 'YEARLY';
  label: string;
  suffix: string;
  /** Pre-formatted amount, e.g. "₹9,000". */
  amount: string;
  /** Plain integer rupees for the UPI `am` field, e.g. "9000". */
  amountRupees: string;
};

export function ReserveForm({
  routeId,
  routeName,
  stops,
  soldOut,
  notBookable = false,
  destinationName,
  plans,
  upi,
  resumeBookingId,
  resumeFare,
  resumeAmountRupees,
  resumePeriodLabel,
  resumeSubmitted = false,
  payBy,
  payByIso,
  bookForStudentId,
  bookingsHref = '/student/bookings',
}: {
  routeId: string;
  routeName: string;
  stops: Stop[];
  soldOut: boolean;
  notBookable?: boolean;
  destinationName: string | null;
  /** Pricing plans the student can pick from (fresh booking flow). */
  plans: PlanOption[];
  /** The platform UPI account to pay into (null = not configured yet). */
  upi?: UpiConfig | null;
  /** Parent flow: book this child (sent to reserve_seat / submit_upi_payment). */
  bookForStudentId?: string;
  /** Where "View my bookings" links to — the parent flow points at /parent. */
  bookingsHref?: string;
  resumeBookingId?: string;
  /** For a resumed booking the plan is already fixed — its amount + label. */
  resumeFare?: string | null;
  /** Plain integer rupees for a resumed booking's UPI `am` field. */
  resumeAmountRupees?: string | null;
  resumePeriodLabel?: string | null;
  /** True when the resumed booking already has a UPI payment awaiting verify. */
  resumeSubmitted?: boolean;
  payBy?: string | null;
  /** ISO payment deadline for a resumed booking, for the live countdown. */
  payByIso?: string | null;
}) {
  // Pre-guard the resume-payment panel: if the window already lapsed at render,
  // open straight on 'expired' rather than briefly showing pay UI that the
  // server would reject (the countdown would flip it a second later anyway).
  const [phase, setPhase] = useState<Phase>(() => {
    if (!resumeBookingId) return 'reserve';
    if (resumeSubmitted) return 'submitted';
    if (payByIso && new Date(payByIso).getTime() <= Date.now()) return 'expired';
    return 'payment';
  });
  const [bookingId, setBookingId] = useState(resumeBookingId ?? '');
  const [payByAt, setPayByAt] = useState<string | null>(null); // ISO deadline from reserve
  const [busy, setBusy] = useState(false); // reserve in-flight
  const [submitting, setSubmitting] = useState(false); // UTR submit in-flight
  const [utr, setUtr] = useState('');
  const [planIdx, setPlanIdx] = useState(0);
  const [payDismissed, setPayDismissed] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  // Reset back to a clean request step and pull fresh server data (seat counts)
  // via a client-side refresh — no full-page reload.
  function requestAgain() {
    setBookingId('');
    setPayByAt(null);
    setPayDismissed(false);
    setUtr('');
    setPhase('reserve');
    router.refresh();
  }

  // Move from the approving popup to the payment step after the pause.
  useEffect(() => {
    if (phase !== 'approving') return;
    const t = setTimeout(() => setPhase('payment'), APPROVAL_MS);
    return () => clearTimeout(t);
  }, [phase]);

  const payByLabel = fmtIST(payByAt) ?? payBy ?? null;
  const deadlineIso = payByAt ?? payByIso ?? null;

  // The plan being paid for: fixed on a resumed booking, else the student's pick.
  const isResume = Boolean(resumeBookingId);
  const selectedPlan = plans[planIdx] ?? plans[0] ?? null;
  const amountLabel = isResume ? (resumeFare ?? null) : (selectedPlan?.amount ?? null);
  const planLabelText = isResume ? (resumePeriodLabel ?? null) : (selectedPlan?.label ?? null);
  const payAmountRupees = isResume ? (resumeAmountRupees ?? '') : (selectedPlan?.amountRupees ?? '');

  const upiConfigured = Boolean(upi?.configured && upi?.vpa);
  const reference = bookingId ? refFor(bookingId) : '';
  const upiString =
    upiConfigured && payAmountRupees && reference
      ? buildUpiString(upi!.vpa, upi!.payee, payAmountRupees, reference)
      : null;

  async function onReserve(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = formRef.current;
    if (!form || busy) return;
    setBusy(true);
    const res = await reserveSeatAction({}, new FormData(form));
    setBusy(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    if (res.status === 'WAITLISTED') {
      toast.warning('Bus is full — you have been added to the waitlist.');
      setPhase('waitlisted');
      return;
    }
    setBookingId(res.bookingId ?? '');
    setPayByAt(res.expiresAt ?? null);
    setPhase('approving');
  }

  async function onSubmitUtr() {
    if (submitting || !bookingId) return;
    const clean = utr.trim();
    if (!/^\d{12}$/.test(clean)) {
      toast.error('Enter the 12-digit UPI reference (UTR) from your UPI app.');
      return;
    }
    setSubmitting(true);
    const fd = new FormData();
    fd.set('bookingId', bookingId);
    fd.set('utr', clean);
    if (bookForStudentId) fd.set('studentId', bookForStudentId);
    const res = await submitUpiPaymentAction({}, fd);
    setSubmitting(false);
    if (res.error) {
      if (res.code === 'P0008' || res.code === 'P0005') setPhase('expired');
      else toast.error(res.error);
      return;
    }
    setPhase('submitted');
  }

  function copyVpa() {
    if (!upi?.vpa) return;
    navigator.clipboard?.writeText(upi.vpa).then(
      () => toast.success('UPI ID copied.'),
      () => toast.error('Could not copy — long-press to copy it.'),
    );
  }

  // ---------- The UPI pay panel (shared by modal) --------------------------
  const upiPanel = (
    <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl sm:p-8">
      <div className="flex items-start justify-between">
        <div className="inline-flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-sm font-medium text-success">
          <CheckCircle2 className="size-4" /> Request approved
        </div>
        <button
          type="button"
          onClick={() => setPayDismissed(true)}
          aria-label="Close"
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-5" />
        </button>
      </div>

      <h2 className="mt-4 text-2xl font-bold sm:text-3xl">Pay with UPI</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Pay {payByLabel ? `before ${payByLabel}` : 'within 10 minutes'} to hold your seat, then
        enter the UPI reference below.
      </p>
      <PaymentCountdown expiresAt={deadlineIso} onExpire={() => setPhase('expired')} />

      {/* Amount */}
      <div className="mt-5 rounded-2xl border border-primary/30 bg-primary/[0.06] p-5 text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Amount to pay</p>
        <p className="tnum mt-1 text-4xl font-extrabold tracking-tight text-primary sm:text-5xl">
          {amountLabel ?? 'Set by agency'}
        </p>
        {planLabelText && <p className="mt-1 text-sm font-semibold text-primary/80">{planLabelText}</p>}
      </div>

      {!upiConfigured ? (
        <p className="mt-5 flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning">
          <Clock3 className="mt-0.5 size-4 shrink-0" />
          Online payments aren&apos;t set up yet. Please try again shortly or contact support.
        </p>
      ) : (
        <>
          {/* QR + VPA */}
          <div className="mt-5 flex flex-col items-center gap-4 rounded-2xl border border-border bg-background p-5">
            {upiString ? (
              <div className="rounded-xl bg-white p-3">
                <QRCodeSVG value={upiString} size={180} includeMargin={false} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Preparing your payment…</p>
            )}
            <p className="text-center text-sm text-muted-foreground">
              Scan with any UPI app, or use your UPI ID below. The amount is filled in for you.
            </p>
            <div className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
              <span className="truncate font-mono text-sm font-medium">{upi!.vpa}</span>
              <button
                type="button"
                onClick={copyVpa}
                className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
              >
                <Copy className="size-3.5" /> Copy
              </button>
            </div>
            {upiString && (
              <a
                href={upiString}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Smartphone className="size-4" /> Open a UPI app to pay
              </a>
            )}
            <p className="text-center text-xs text-muted-foreground">Reference: {reference}</p>
          </div>

          {/* UTR */}
          <div className="mt-5 space-y-2">
            <Label htmlFor="utr">Enter your UPI reference (UTR) after paying</Label>
            <Input
              id="utr"
              inputMode="numeric"
              maxLength={12}
              value={utr}
              onChange={(e) => setUtr(e.target.value.replace(/\D/g, ''))}
              placeholder="12-digit reference from your UPI app"
              className="text-center text-lg font-semibold tracking-[0.2em]"
            />
            <Button className="w-full" onClick={onSubmitUtr} disabled={submitting || utr.trim().length !== 12}>
              {submitting ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" /> Submitting…
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  I&apos;ve paid — submit reference <ArrowRight className="size-4" />
                </span>
              )}
            </Button>
          </div>
        </>
      )}

      <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5" /> We confirm your seat once the payment is verified.
      </p>
    </div>
  );

  const approvingModal = phase === 'approving' && (
    <Overlay label="Approving your request">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-xl">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Loader2 className="size-8 animate-spin" />
        </span>
        <h2 className="mt-4 text-xl font-bold">Approving your request…</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          We&apos;re checking everything and approving automatically. This only takes a few seconds.
        </p>
        <ul className="mx-auto mt-5 max-w-xs space-y-2 text-left text-sm">
          {CHECKS.map((c) => (
            <li key={c} className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2">
              <CheckCircle2 className="size-4 shrink-0 text-success" />
              <span>{c}</span>
            </li>
          ))}
        </ul>
      </div>
    </Overlay>
  );

  const paymentModal = phase === 'payment' && !payDismissed && (
    <Overlay label="Pay with UPI" onClose={() => setPayDismissed(true)}>
      {upiPanel}
    </Overlay>
  );

  const modals = (
    <>
      {approvingModal}
      {paymentModal}
    </>
  );

  // ---------- Sidebar panel content ---------------------------------------
  if (phase === 'submitted') {
    return (
      <div className="space-y-3">
        <PanelSteps active={3} />
        <div className="flex items-start gap-2.5 rounded-lg border border-primary/30 bg-primary/[0.06] px-3 py-2.5 text-sm">
          <Clock3 className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>
            Payment submitted — we&apos;re verifying it. Your seat is held and will be confirmed
            shortly. We&apos;ll notify you the moment it&apos;s confirmed.
          </span>
        </div>
        <Link
          href={bookingsHref}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary/70"
        >
          Track it in My bookings <ArrowRight className="size-4" />
        </Link>
      </div>
    );
  }

  if (phase === 'waitlisted') {
    return (
      <div className="space-y-3">
        <PanelSteps active={1} />
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning">
          <Clock3 className="mt-0.5 size-4 shrink-0" />
          <span>Bus is full — you are on the waitlist. We&apos;ll notify you if a seat opens up.</span>
        </div>
        <Link
          href={bookingsHref}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary/70"
        >
          View in My bookings <ArrowRight className="size-4" />
        </Link>
      </div>
    );
  }

  if (phase === 'expired') {
    return (
      <div className="space-y-3">
        <PanelSteps active={3} />
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          <Clock3 className="mt-0.5 size-4 shrink-0" />
          <span>
            Your payment window expired and the seat hold was released. You can request the seat again if
            it&apos;s still available.
          </span>
        </div>
        <Button className="w-full" onClick={requestAgain}>
          Request the seat again
        </Button>
      </div>
    );
  }

  if (phase === 'approving') {
    return (
      <div className="space-y-3">
        <PanelSteps active={2} />
        {modals}
        <div className="flex items-center gap-2.5 rounded-lg border border-primary/30 bg-primary/[0.06] px-3 py-2.5 text-sm">
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
          <span>Approving your request…</span>
        </div>
      </div>
    );
  }

  if (phase === 'payment') {
    return (
      <div className="space-y-3">
        <PanelSteps active={3} />
        {modals}
        <div className="rounded-lg border border-success/30 bg-success/[0.08] px-3 py-2.5 text-sm">
          <p className="font-medium text-success">Request approved</p>
          <p className="text-muted-foreground">
            Pay with UPI{payByLabel ? ` before ${payByLabel}` : ' within 10 minutes'} to hold your seat.
          </p>
        </div>
        {payDismissed && (
          <PaymentCountdown expiresAt={deadlineIso} onExpire={() => setPhase('expired')} />
        )}
        <Button className="w-full" onClick={() => setPayDismissed(false)}>
          Pay now
        </Button>
      </div>
    );
  }

  // ---------- Not bookable -------------------------------------------------
  if (notBookable) {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
        <MapPin className="mt-0.5 size-4 shrink-0" />
        <span>This route isn&apos;t accepting bookings right now. Please check back later or pick another ride.</span>
      </div>
    );
  }

  // ---------- Step 1: request ---------------------------------------------
  return (
    <form ref={formRef} onSubmit={onReserve} className="space-y-4">
      <PanelSteps active={1} />
      <input type="hidden" name="routeId" value={routeId} />
      {bookForStudentId && <input type="hidden" name="studentId" value={bookForStudentId} />}
      {selectedPlan && <input type="hidden" name="billingPeriod" value={selectedPlan.period} />}

      {plans.length > 0 && (
        <div className="space-y-2">
          <Label>Choose a plan</Label>
          <div className="grid gap-2">
            {plans.map((p, i) => {
              const on = i === planIdx;
              return (
                <button
                  key={p.period}
                  type="button"
                  onClick={() => setPlanIdx(i)}
                  aria-pressed={on}
                  className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors ${
                    on ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <span
                      className={`grid size-4 shrink-0 place-items-center rounded-full border ${
                        on ? 'border-primary' : 'border-muted-foreground/40'
                      }`}
                    >
                      {on && <span className="size-2 rounded-full bg-primary" />}
                    </span>
                    <span className="text-sm font-medium">{p.label}</span>
                  </span>
                  <span className="tnum text-sm font-semibold">
                    {p.amount}
                    <span className="text-muted-foreground">{p.suffix}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="pickupStopId">Pickup stop</Label>
        <SelectMenu
          id="pickupStopId"
          name="pickupStopId"
          defaultValue={stops[0]?.id ?? ''}
          placeholder="Select pickup stop"
          options={stops.map((s) => ({ value: s.id, label: s.name }))}
        />
      </div>

      <div className="space-y-2">
        <Label>Drop-off</Label>
        <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          <GraduationCap className="size-4 shrink-0 text-primary" />
          <span className="font-medium">{destinationName ?? 'Your campus'}</span>
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={busy || stops.length === 0}>
        {busy ? 'Sending request…' : soldOut ? 'Join waitlist' : 'Request seat'}
      </Button>
      <p className="text-xs text-muted-foreground">
        Your request is approved automatically once we confirm the seat, pickup and eligibility — then you
        pay by UPI to lock it in.
      </p>
      {stops.length === 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="size-3.5" /> This route has no pickup stops yet.
        </p>
      )}
    </form>
  );
}

function Overlay({
  label,
  onClose,
  children,
}: {
  label: string;
  /** When provided, Escape and a backdrop click dismiss the dialog. */
  onClose?: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useModalFocusTrap(true, ref, onClose);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      onMouseDown={(e) => {
        if (onClose && e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/50 p-4 backdrop-blur-xs outline-none"
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      {children}
    </div>
  );
}
