import type { SupabaseClient } from '@supabase/supabase-js';
import { planPrice, type BillingPeriod } from '@/lib/billing';

export interface RideEvent {
  stage: string; // BOARDED | REACHED | GOT_OFF
  at: string; // recorded_at ISO
}

export interface RideHistoryRow {
  booking_id: string;
  status: string;
  student_name: string | null;
  route_name: string | null;
  college_name: string | null;
  bus_number: string | null;
  agency_name: string | null;
  pickup_name: string | null;
  billing_period: BillingPeriod | null;
  /** Price of the plan this booking was made under (falls back to the flat fare). */
  price_cents: number | null;
  paid_at: string | null;
  created_at: string;
  /** Ride-event timeline, most recent first. */
  events: RideEvent[];
}

/**
 * The caller's trip history — their own rides (as a student) or their linked
 * children's (as a parent), via the `my_ride_history` security-definer RPC. Each
 * row carries the receipt fields + the ride-event timeline; price is resolved to
 * the chosen plan here (reusing billing.ts) rather than in SQL.
 */
export async function listMyRideHistory(db: SupabaseClient): Promise<RideHistoryRow[]> {
  const { data, error } = await db.rpc('my_ride_history');
  if (error) throw error;
  type Raw = {
    booking_id: string;
    status: string;
    student_name: string | null;
    route_name: string | null;
    college_name: string | null;
    bus_number: string | null;
    agency_name: string | null;
    pickup_name: string | null;
    billing_period: string | null;
    price_cents: number | null;
    price_monthly_cents: number | null;
    price_semester_cents: number | null;
    price_yearly_cents: number | null;
    paid_at: string | null;
    created_at: string;
    events: RideEvent[] | null;
  };
  return ((data ?? []) as Raw[]).map((r) => {
    const period = (r.billing_period ?? null) as BillingPeriod | null;
    return {
      booking_id: r.booking_id,
      status: r.status,
      student_name: r.student_name,
      route_name: r.route_name,
      college_name: r.college_name,
      bus_number: r.bus_number,
      agency_name: r.agency_name,
      pickup_name: r.pickup_name,
      billing_period: period,
      price_cents: planPrice(r, period) ?? r.price_cents,
      paid_at: r.paid_at,
      created_at: r.created_at,
      events: (r.events ?? []) as RideEvent[],
    };
  });
}
