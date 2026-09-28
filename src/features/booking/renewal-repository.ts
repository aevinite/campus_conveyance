import type { SupabaseClient } from '@supabase/supabase-js';
import type { BillingPeriod } from '@/lib/billing';
import type { RenewInfo } from '@/components/renew-pass-panel';

/** Renew-screen data for a booking the caller (rider or linked parent) can act for. */
export async function getRenewInfo(db: SupabaseClient, bookingId: string): Promise<RenewInfo | null> {
  const { data, error } = await db.rpc('pass_renewal_info', { p_booking_id: bookingId });
  if (error) throw error;
  const r = ((data ?? []) as Record<string, unknown>[])[0];
  if (!r) return null;
  return {
    bookingId: r.booking_id as string,
    studentName: (r.student_name as string | null) ?? null,
    routeName: (r.route_name as string) ?? 'Your route',
    currentPeriod: (r.billing_period as BillingPeriod | null) ?? null,
    passEnd: (r.pass_end as string | null) ?? null,
    canRenew: r.can_renew === true,
    reason: (r.reason as string | null) ?? null,
    pendingPeriod: (r.pending_period as BillingPeriod | null) ?? null,
    pendingUtr: (r.pending_utr as string | null) ?? null,
    reference: r.reference as string,
    prices: {
      MONTHLY: (r.price_monthly_cents as number | null) ?? null,
      SEMESTER: (r.price_semester_cents as number | null) ?? null,
      YEARLY: (r.price_yearly_cents as number | null) ?? null,
    },
  };
}
