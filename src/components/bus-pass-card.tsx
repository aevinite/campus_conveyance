import Link from 'next/link';
import { BusFront, CalendarClock, Clock3, MapPin, ArrowRight, RefreshCw, CheckCircle2 } from 'lucide-react';
import { periodLabel, type BillingPeriod } from '@/lib/billing';
import { computePass, daysLeftLabel } from '@/lib/pass';
import { formatDateMedium } from '@/lib/format-date';

export interface BusPassCardProps {
  routeName: string | null;
  billingPeriod: BillingPeriod | null;
  /** Booking status: CONFIRMED | PENDING | WAITLISTED. */
  status: string;
  isPaid: boolean;
  /** UPI step (UNPAID | SUBMITTED | PAID | REJECTED) — distinguishes "verifying". */
  paymentStatus?: string | null;
  /** When the pass began: paid_at ?? created_at. */
  startIso: string | null;
  pickupName?: string | null;
  busNumber?: string | null;
  /** Where "Manage" / "Finish paying" go. */
  manageHref: string;
  /** Where "Renew" goes (the route so they can buy a new plan). */
  renewHref: string;
  /** Optional owner label for the parent view, e.g. "Aarav". */
  whoLabel?: string | null;
  /** Denser padding + smaller number, for the app + per-child grids. */
  compact?: boolean;
  className?: string;
}

// One place for the per-state look: card chrome + accent text/fill.
type Tone = { wrap: string; chip: string; num: string; bar: string; icon: string };
const TONES: Record<'ok' | 'warn' | 'danger' | 'neutral', Tone> = {
  ok: {
    wrap: 'border-success/30 bg-success/[0.06]',
    chip: 'border-success/30 bg-success/10 text-success',
    num: 'text-success',
    bar: 'bg-success',
    icon: 'bg-success/15 text-success',
  },
  warn: {
    wrap: 'border-warning/40 bg-warning/[0.08]',
    chip: 'border-warning/30 bg-warning/10 text-warning',
    num: 'text-warning',
    bar: 'bg-warning',
    icon: 'bg-warning/15 text-warning',
  },
  danger: {
    wrap: 'border-destructive/40 bg-destructive/[0.07]',
    chip: 'border-destructive/30 bg-destructive/10 text-destructive',
    num: 'text-destructive',
    bar: 'bg-destructive',
    icon: 'bg-destructive/15 text-destructive',
  },
  neutral: {
    wrap: 'border-primary/30 bg-primary/[0.06]',
    chip: 'border-primary/30 bg-primary/10 text-primary',
    num: 'text-primary',
    bar: 'bg-primary',
    icon: 'bg-primary text-primary-foreground',
  },
};

/**
 * The headline dashboard widget: the rider's active bus pass. Shows the plan,
 * how many days are left (with a progress bar), and — when it's ending soon or
 * lapsed — turns amber/red with a Renew call to action. Also covers the not-yet-
 * active states (payment pending / verifying / waitlisted). Presentational.
 */
export function BusPassCard(props: BusPassCardProps) {
  const {
    routeName,
    billingPeriod,
    status,
    isPaid,
    paymentStatus,
    startIso,
    pickupName,
    busNumber,
    manageHref,
    renewHref,
    whoLabel,
    compact = false,
    className = '',
  } = props;

  const title = whoLabel ? `${whoLabel}'s bus pass` : 'Your bus pass';
  const route = routeName ?? 'Your route';
  const planText = periodLabel(billingPeriod) || 'Active plan';
  const pad = compact ? 'p-4' : 'p-5 sm:p-6';

  // ---- Not-yet-active states -------------------------------------------------
  if (status === 'WAITLISTED') {
    return (
      <Shell tone="warn" pad={pad} className={className} title={title} icon={<Clock3 />}>
        <p className="text-sm font-semibold">{route}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          On the waitlist — we&apos;ll notify you the moment a seat opens up.
        </p>
        <CardLink href={manageHref} label="View booking" />
      </Shell>
    );
  }
  if (status === 'PENDING') {
    const verifying = paymentStatus === 'SUBMITTED' || isPaid;
    return (
      <Shell tone={verifying ? 'neutral' : 'warn'} pad={pad} className={className} title={title} icon={<Clock3 />}>
        <p className="text-sm font-semibold">{route}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {verifying
            ? 'Payment submitted — we’re verifying it. Your seat is held and confirms shortly.'
            : 'Approved — finish the UPI payment to activate your pass.'}
        </p>
        {!verifying && <CardLink href={manageHref} label="Finish payment" solid />}
        {verifying && <CardLink href={manageHref} label="View booking" />}
      </Shell>
    );
  }

  // ---- Active (CONFIRMED) pass ----------------------------------------------
  const pass = computePass(startIso, billingPeriod);
  const tone: keyof typeof TONES = !pass ? 'ok' : pass.expired ? 'danger' : pass.expiring ? 'warn' : 'ok';
  const t = TONES[tone];
  const needsRenew = pass ? pass.expiring || pass.expired : false;

  return (
    <div className={`rounded-2xl border ${t.wrap} ${pad} ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${t.icon}`}>
            <BusFront className="size-6" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {title}
            </p>
            <p className="mt-0.5 truncate text-base font-bold tracking-tight sm:text-lg">{route}</p>
            <span className={`mt-1 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${t.chip}`}>
              <CheckCircle2 className="size-3" /> {planText}
            </span>
          </div>
        </div>
        {pass && (
          <div className="shrink-0 text-right">
            <p className={`tnum font-heading text-3xl font-extrabold leading-none ${t.num} ${compact ? '' : 'sm:text-4xl'}`}>
              {pass.expired ? 0 : pass.daysLeft}
            </p>
            <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {pass.expired ? 'expired' : 'days left'}
            </p>
          </div>
        )}
      </div>

      {pass && (
        <>
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className={`h-full rounded-full ${t.bar}`} style={{ width: `${pass.pctElapsed}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="size-3.5" />
              {pass.expired ? 'Ended' : 'Valid until'}{' '}
              <span className="font-semibold text-foreground">{formatDateMedium(pass.endsAt.toISOString())}</span>
            </span>
            <span className="font-medium">{daysLeftLabel(pass)}</span>
          </div>
        </>
      )}

      {(pickupName || busNumber) && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          {busNumber && (
            <span className="inline-flex items-center gap-1.5">
              <BusFront className="size-3.5" /> Bus {busNumber}
            </span>
          )}
          {pickupName && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-3.5" /> {pickupName}
            </span>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {needsRenew ? (
          <Link
            href={renewHref}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-warning px-4 py-2 text-sm font-semibold text-[oklch(0.24_0.05_60)] shadow-sm transition-transform hover:-translate-y-0.5"
          >
            <RefreshCw className="size-4" /> Renew pass
          </Link>
        ) : null}
        <Link
          href={manageHref}
          className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
            needsRenew
              ? 'border border-border bg-background hover:bg-muted'
              : 'border border-border bg-background hover:bg-muted'
          }`}
        >
          Manage <ArrowRight className="size-4" />
        </Link>
      </div>
    </div>
  );
}

// Small shell for the non-active states (waitlist / pending) so they share chrome.
function Shell({
  tone,
  pad,
  className,
  title,
  icon,
  children,
}: {
  tone: keyof typeof TONES;
  pad: string;
  className: string;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = TONES[tone];
  return (
    <div className={`rounded-2xl border ${t.wrap} ${pad} ${className}`}>
      <div className="flex items-start gap-3">
        <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${t.icon}`}>{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

function CardLink({ href, label, solid = false }: { href: string; label: string; solid?: boolean }) {
  return (
    <Link
      href={href}
      className={`mt-3 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
        solid
          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
          : 'border border-border bg-background hover:bg-muted'
      }`}
    >
      {label} <ArrowRight className="size-4" />
    </Link>
  );
}
