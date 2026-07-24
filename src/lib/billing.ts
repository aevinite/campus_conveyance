// Billing periods a route can be priced by. Campus transport is semester-based
// (a semester = 6 months), so agencies price per month, per semester, or per
// year — and the student picks a plan at checkout. See migration 0090.

export type BillingPeriod = 'MONTHLY' | 'SEMESTER' | 'YEARLY';

export const BILLING_PERIODS: {
  period: BillingPeriod;
  /** Full label for a plan option, e.g. "Per semester (6 months)". */
  label: string;
  /** Short noun, e.g. "Semester" — for column headings / chips. */
  short: string;
  /** Compact price suffix, e.g. "/sem". */
  suffix: string;
  months: number;
}[] = [
  { period: 'MONTHLY', label: 'Per month', short: 'Monthly', suffix: '/mo', months: 1 },
  { period: 'SEMESTER', label: 'Per semester (6 months)', short: 'Semester', suffix: '/sem', months: 6 },
  { period: 'YEARLY', label: 'Per year', short: 'Yearly', suffix: '/yr', months: 12 },
];

/** The three per-period price columns carried on a route (paise/cents). */
export interface RoutePlanPrices {
  price_monthly_cents: number | null;
  price_semester_cents: number | null;
  price_yearly_cents: number | null;
}

export interface OfferedPlan {
  period: BillingPeriod;
  cents: number;
  label: string;
  suffix: string;
}

/** The plans an agency actually priced for a route, in period order. */
export function offeredPlans(r: RoutePlanPrices): OfferedPlan[] {
  const map: Record<BillingPeriod, number | null> = {
    MONTHLY: r.price_monthly_cents,
    SEMESTER: r.price_semester_cents,
    YEARLY: r.price_yearly_cents,
  };
  return BILLING_PERIODS.filter(
    (p) => map[p.period] != null && (map[p.period] as number) > 0,
  ).map((p) => ({
    period: p.period,
    cents: map[p.period] as number,
    label: p.label,
    suffix: p.suffix,
  }));
}

export function periodLabel(p: BillingPeriod | null | undefined): string {
  return BILLING_PERIODS.find((b) => b.period === p)?.label ?? '';
}

export function periodShort(p: BillingPeriod | null | undefined): string {
  return BILLING_PERIODS.find((b) => b.period === p)?.short ?? '';
}

export function periodSuffix(p: BillingPeriod | null | undefined): string {
  return BILLING_PERIODS.find((b) => b.period === p)?.suffix ?? '';
}

/** The price (cents) a route charges for one specific plan, or null if unset. */
export function planPrice(r: RoutePlanPrices, period: BillingPeriod | null | undefined): number | null {
  switch (period) {
    case 'MONTHLY':
      return r.price_monthly_cents;
    case 'SEMESTER':
      return r.price_semester_cents;
    case 'YEARLY':
      return r.price_yearly_cents;
    default:
      return null;
  }
}
