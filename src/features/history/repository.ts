import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * One actual ride (boarding) taken by the caller or their linked child. Trip
 * history is a list of these, newest boarding first.
 */
export interface RideHistoryRow {
  /** ride_events.id of the BOARDED event — a stable key for the trip. */
  ride_id: string;
  booking_id: string;
  student_name: string | null;
  route_name: string | null;
  college_name: string | null;
  bus_number: string | null;
  agency_name: string | null;
  pickup_name: string | null;
  /** When the driver marked the rider boarded (the trip's date + time). */
  boarded_at: string;
  /** That same day's "reached campus" / "got off" times, if recorded. */
  reached_at: string | null;
  got_off_at: string | null;
}

/**
 * The caller's trip history — the rides they actually took (as a student) or
 * their linked children took (as a parent), via the `my_ride_history`
 * security-definer RPC. One row per boarding, newest first; cancelled / rejected
 * bookings and never-ridden bookings are excluded in SQL.
 */
export async function listMyRideHistory(db: SupabaseClient): Promise<RideHistoryRow[]> {
  const { data, error } = await db.rpc('my_ride_history');
  if (error) throw error;
  return ((data ?? []) as RideHistoryRow[]).map((r) => ({
    ride_id: r.ride_id,
    booking_id: r.booking_id,
    student_name: r.student_name,
    route_name: r.route_name,
    college_name: r.college_name,
    bus_number: r.bus_number,
    agency_name: r.agency_name,
    pickup_name: r.pickup_name,
    boarded_at: r.boarded_at,
    reached_at: r.reached_at,
    got_off_at: r.got_off_at,
  }));
}
