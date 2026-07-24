'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useModalFocusTrap } from '@/lib/use-modal-focus-trap';
import { formatTime } from '@/lib/format-date';
import {
  MapPin,
  GraduationCap,
  CheckCircle2,
  Clock3,
  ArrowRight,
  Smartphone,
  CreditCard,
  Landmark,
  ShieldCheck,
  Loader2,
  Ticket,
  X,
} from 'lucide-react';
import {
  reserveSeatAction,
  payBookingAction,
} from '@/features/booking/actions';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { SelectMenu } from '@/components/ui/select-menu';
import type { Stop } from '@/features/booking/repository';
import { PaymentCountdown } from './payment-countdown';

// The auto-approval runs server-side inside reserve_seat (seat availability,
// pickup validity and campus eligibility are all checked there). This is the
// on-screen "Approving your request…" pause — kept well under 30 seconds.
const APPROVAL_MS = 4000;

const METHODS = [
  { value: 'UPI', label: 'UPI', icon: Smartphone, hint: 'GPay · PhonePe · Paytm' },
  { value: 'CARD', label: 'Credit / Debit card', icon: CreditCard, hint: 'Visa · Mastercard · RuPay' },
  { value: 'NETBANKING', label: 'Net banking', icon: Landmark, hint: 'All major banks' },
];

const CHECKS = ['Seat availability', 'Your pickup stop', 'Campus eligibility'];

type Phase = 'reserve' | 'approving' | 'payment' | 'done' | 'waitlisted' | 'expired';

function fmtIST(iso: string | null): string | null {
  return iso ? formatTime(iso) : null;
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
};

export function ReserveForm({
  routeId,
  routeName,
  stops,
  soldOut,
  notBookable = false,
  destinationName,
  plans,
  resumeBookingId,
  resumeFare,
  resumePeriodLabel,
  resumePickupName,
  payBy,
  payByIso,
}: {
  routeId: string;
  routeName: string;
  stops: Stop[];
  soldOut: boolean;
  notBookable?: boolean;
  destinationName: string | null;
  /** Pricing plans the student can pick from (fresh booking flow). */
  plans: PlanOption[];
  resumeBookingId?: string;
  /** For a resumed booking the plan is already fixed — its amount + label. */
  resumeFare?: string | null;
  resumePeriodLabel?: string | null;
  /** Pickup name for a resumed booking (chosen at request time, not re-selected
   *  here) so the confirmation receipt can still show the Pickup line. */
  resumePickupName?: string | null;
  payBy?: string | null;
  /** ISO payment deadline for a resumed booking, for the live countdown. */
  payByIso?: string | null;
}) {
  // Pre-guard the resume-payment panel: if the window already lapsed at render,
  // open straight on 'expired' rather than briefly showing pay buttons that the
  // server would reject (the countdown would flip it a second later anyway).
  const [phase, setPhase] = useState<Phase>(() => {
    if (!resumeBookingId) return 'reserve';
    if (payByIso && new Date(payByIso).getTime() <= Date.now()) return 'expired';
    return 'payment';
  });
  const [bookingId, setBookingId] = useState(resumeBookingId ?? '');
  const [payByAt, setPayByAt] = useState<string | null>(null); // ISO deadline from reserve
  const [busy, setBusy] = useState(false); // reserve in-flight
  const [paying, setPaying] = useState(false);
  const [method, setMethod] = useState<string | null>(null);
  const [pickupId, setPickupId] = useState(resumeBookingId ? '' : (stops[0]?.id ?? ''));
  const [planIdx, setPlanIdx] = useState(0);
  const [payDismissed, setPayDismissed] = useState(false);
  const [receiptDismissed, setReceiptDismissed] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  // Reset back to a clean request step and pull fresh server data (seat counts)
  // via a client-side refresh — no full-page reload.
  function requestAgain() {
    setBookingId('');
    setPayByAt(null);
    setPayDismissed(false);
    setPickupId(stops[0]?.id ?? ''); // reset pickup too, else the receipt shows a stale one
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
  // ISO deadline for the live countdown: from a fresh reserve, else the resumed
  // booking's deadline passed by the server.
  const deadlineIso = payByAt ?? payByIso ?? null;
  // Fall back to the resumed booking's pickup (pickupId is empty on resume).
  const pickupName = stops.find((s) => s.id === pickupId)?.name ?? resumePickupName ?? null;
  const methodLabel = METHODS.find((m) => m.value === method)?.label ?? null;

  // The plan being paid for: fixed on a resumed booking, else the student's pick.
  const isResume = Boolean(resumeBookingId);
  const selectedPlan = plans[planIdx] ?? plans[0] ?? null;
  const amountLabel = isResume ? (resumeFare ?? null) : (selectedPlan?.amount ?? null);
  const planLabelText = isResume ? (resumePeriodLabel ?? null) : (selectedPlan?.label ?? null);

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
    // Held seat — reserve_seat already auto-approved it. Show the approving
    // popup, then reveal the big payment step.
    setBookingId(res.bookingId ?? '');
    setPayByAt(res.expiresAt ?? null);
    setPhase('approving');
  }

  async function onPay(value: string) {
    if (paying || !bookingId) return;
    setMethod(value);
    setPaying(true);
    const fd = new FormData();
    fd.set('bookingId', bookingId);
    fd.set('routeId', routeId);
    fd.set('method', value);
    const res = await payBookingAction({}, fd);
    setPaying(false);
    if (res.error) {
      const expired =
        res.code === 'P0008' ||
        res.code === 'P0005' ||
        (!res.code && /expired|held seat|no longer|reserve the seat again/i.test(res.error));
      if (expired) setPhase('expired');
      else toast.error(res.error);
      return;
    }
    setPhase('done');
  }

  // ---------- Modals -------------------------------------------------------
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
    <Overlay label="Complete payment" onClose={() => setPayDismissed(true)}>
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

        <h2 className="mt-4 text-2xl font-bold sm:text-3xl">Complete your payment</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pay {payByLabel ? `before ${payByLabel}` : 'within 20 minutes'} to confirm your seat —
          unpaid bookings are released after the window.
        </p>
        <PaymentCountdown expiresAt={deadlineIso} onExpire={() => setPhase('expired')} />

        {/* Big, prominent amount */}
        <div className="mt-5 rounded-2xl border border-primary/30 bg-primary/[0.06] p-6 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Amount payable</p>
          <p className="tnum mt-1 text-5xl font-extrabold tracking-tight text-primary sm:text-6xl">
            {amountLabel ?? 'Set by agency'}
          </p>
          {planLabelText && (
            <p className="mt-1 text-sm font-semibold text-primary/80">{planLabelText}</p>
          )}
          <p className="mt-2 text-sm text-muted-foreground">{routeName}</p>
        </div>

        <p className="mt-6 mb-2 text-sm font-semibold">Choose a payment method</p>
        <div className="space-y-2.5">
          {METHODS.map((m) => (
            <button
              key={m.value}
              type="button"
              disabled={paying}
              onClick={() => onPay(m.value)}
              className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:opacity-60"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-secondary text-foreground">
                <m.icon className="size-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold">{m.label}</span>
                <span className="block text-xs text-muted-foreground">{m.hint}</span>
              </span>
              {paying && method === m.value ? (
                <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <ArrowRight className="size-5 shrink-0 text-muted-foreground" />
              )}
            </button>
          ))}
        </div>

        <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" /> Demo payment — no real charge is made.
        </p>
      </div>
    </Overlay>
  );

  const receiptModal = phase === 'done' && !receiptDismissed && (
    <Overlay label="Booking confirmed" onClose={() => setReceiptDismissed(true)}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <span className="grid size-12 place-items-center rounded-2xl bg-success/10 text-success">
            <CheckCircle2 className="size-7" />
          </span>
          <button
            type="button"
            onClick={() => setReceiptDismissed(true)}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>
        <h2 className="mt-4 text-xl font-bold">Booking confirmed!</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Payment received — your seat is confirmed. Have a safe ride!
        </p>
        <dl className="mt-5 space-y-2.5 rounded-xl border border-border bg-muted/30 p-4 text-sm">
          {[
            ['Route', routeName],
            ['Pickup', pickupName],
            ['Drop-off', destinationName ?? 'Your campus'],
            ['Plan', planLabelText],
            ['Fare paid', amountLabel ?? 'Set by agency'],
            ['Paid via', methodLabel],
            ['Status', 'Confirmed'],
          ]
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="flex items-start justify-between gap-4">
                <dt className="shrink-0 text-muted-foreground">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
        </dl>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Link href="/student/bookings" className="flex-1">
            <Button className="w-full gap-1.5">
              <Ticket className="size-4" /> View My bookings
            </Button>
          </Link>
          <Button variant="outline" className="flex-1" onClick={() => setReceiptDismissed(true)}>
            Close
          </Button>
        </div>
      </div>
    </Overlay>
  );

  const modals = (
    <>
      {approvingModal}
      {paymentModal}
      {receiptModal}
    </>
  );

  // ---------- Sidebar panel content ---------------------------------------
  if (phase === 'done') {
    return (
      <div className="space-y-3">
        <PanelSteps active={3} />
        {modals}
        <div className="flex items-start gap-2.5 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <span>Payment successful — your seat is confirmed. Have a safe ride!</span>
        </div>
        <Link
          href="/student/bookings"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary/70"
        >
          View in My bookings <ArrowRight className="size-4" />
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
          href="/student/bookings"
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
            Complete the payment{payByLabel ? ` before ${payByLabel}` : ' within 20 minutes'} to confirm
            your seat.
          </p>
        </div>
        {/* Only when the modal is DISMISSED — otherwise the modal's own countdown
            (paymentModal) is showing, and rendering both spins two intervals that
            both fire onExpire. This panel one keeps ticking after dismissal and
            flips to 'expired' on its own. */}
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
          onValueChange={setPickupId}
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
        pay to lock it in.
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
  // Shared modal a11y (initial focus, trap, Escape, restore). Overlay is mounted
  // only while shown, so `open` is always true here.
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
