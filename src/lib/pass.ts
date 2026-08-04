// Bus-pass window maths. A rider buys a plan (monthly / semester / yearly) when
// they confirm a booking; the "pass" runs from that confirmation for the plan's
// length. The dashboards surface how many days are left and nudge a renewal when
// it's nearly up. Pure + framework-free so it works on server and client.
import { BILLING_PERIODS, type BillingPeriod } from '@/lib/billing';

const MS_DAY = 86_400_000;
/** A pass with ≤ this many days left is "expiring soon" (amber renewal nudge). */
export const EXPIRING_SOON_DAYS = 7;

export interface PassInfo {
  /** When the plan window ends. */
  endsAt: Date;
  /** Whole days remaining (can be 0 or negative if already ended). */
  daysLeft: number;
  /** Length of the whole plan window in days. */
  totalDays: number;
  /** 0–100, how much of the window has elapsed. */
  pctElapsed: number;
  /** Ends within EXPIRING_SOON_DAYS (and not yet expired). */
  expiring: boolean;
  /** Window has fully elapsed. */
  expired: boolean;
}

/**
 * Compute the pass window for a confirmed booking. `startIso` is when the pass
 * began — the paid/confirmed time (fall back to the booking's created_at, which
 * is only minutes earlier). Returns null if we can't (no plan or bad date).
 */
export function computePass(
  startIso: string | null | undefined,
  period: BillingPeriod | null | undefined,
): PassInfo | null {
  if (!startIso || !period) return null;
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return null;
  const months = BILLING_PERIODS.find((b) => b.period === period)?.months;
  if (!months) return null;

  const end = new Date(start);
  end.setMonth(end.getMonth() + months);
  const now = Date.now();
  const totalMs = end.getTime() - start.getTime();
  const totalDays = Math.max(1, Math.round(totalMs / MS_DAY));
  const daysLeft = Math.ceil((end.getTime() - now) / MS_DAY);
  const pctElapsed = Math.min(100, Math.max(0, ((now - start.getTime()) / totalMs) * 100));
  const expired = daysLeft <= 0;
  return {
    endsAt: end,
    daysLeft,
    totalDays,
    pctElapsed,
    expired,
    expiring: !expired && daysLeft <= EXPIRING_SOON_DAYS,
  };
}

/** "5 days left" / "1 day left" / "Ends today" / "Expired". */
export function daysLeftLabel(p: PassInfo): string {
  if (p.expired) return 'Expired';
  if (p.daysLeft === 0) return 'Ends today';
  return `${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'} left`;
}
