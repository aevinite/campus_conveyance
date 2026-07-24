import { cache } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface DriverProfile {
  driver_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  license_no: string | null;
  is_active: boolean;
  agency_name: string | null;
}
export interface DriverBus {
  vehicle_id: string;
  bus_number: string | null;
  registration_no: string | null;
  is_ac: boolean;
  capacity: number;
  bus_model: string | null;
  bus_color: string | null;
  image_url: string | null;
  route_id: string | null;
  route_name: string | null;
  departure_time: string | null;
  price_cents: number | null;
  college_name: string | null;
  stops_count: number;
  seats_total: number | null;
  seats_reserved: number | null;
}
export interface DriverBooking {
  booking_id: string;
  status: string;
  created_at: string;
  student_name: string | null;
  student_phone: string | null;
  bus_number: string | null;
  route_name: string | null;
  pickup_name: string | null;
  college_name: string | null;
  /** Latest journey stage recorded today: BOARDED | REACHED | GOT_OFF | null. */
  current_stage: string | null;
}

export interface DriverRouteStop {
  route_id: string;
  route_name: string | null;
  bus_number: string | null;
  stop_id: string;
  stop_name: string | null;
  sequence: number;
  /** Current status of this stop today: NEXT | SKIPPED | null. */
  status: string | null;
  rider_count: number;
}

export interface DriverStatus {
  is_online: boolean;
  lat: number | null;
  lng: number | null;
  updated_at: string | null;
}

/** The signed-in driver's live-tracking state (drives the online/offline toggle). */
export async function getDriverStatus(db: SupabaseClient): Promise<DriverStatus> {
  const { data, error } = await db.rpc('driver_status');
  if (error) throw error;
  return (
    ((data ?? [])[0] as DriverStatus) ?? {
      is_online: false,
      lat: null,
      lng: null,
      updated_at: null,
    }
  );
}

/** The signed-in driver's own profile (null if the account isn't a driver).
 *  Memoized per request: the panel layout and every page read it. */
export const getDriverProfile = cache(
  async (db: SupabaseClient): Promise<DriverProfile | null> => {
    const { data, error } = await db.rpc('driver_profile');
    if (error) throw error;
    return ((data ?? [])[0] as DriverProfile) ?? null;
  },
);

/** Buses the driver drives today (one row per route). Memoized per request —
 *  the layout (to decide whether to show the live-tracking toggle) and the
 *  dashboard/buses pages all read it. */
export const listDriverBuses = cache(async (db: SupabaseClient): Promise<DriverBus[]> => {
  const { data, error } = await db.rpc('driver_buses');
  if (error) throw error;
  return (data ?? []) as DriverBus[];
});

export async function listDriverBookings(
  db: SupabaseClient,
  opts: { limit?: number; offset?: number } = {},
): Promise<DriverBooking[]> {
  const { data, error } = await db.rpc('driver_bookings', {
    p_limit: opts.limit ?? null,
    p_offset: opts.offset ?? 0,
  });
  if (error) throw error;
  return (data ?? []) as DriverBooking[];
}

/** Ordered pickup stops for every bus the driver drives today, each with its
 *  current status (next/skipped) and how many riders are waiting there. Drives
 *  the "Route progress" page; the UI groups the rows by route. */
export async function listDriverRouteProgress(
  db: SupabaseClient,
): Promise<DriverRouteStop[]> {
  const { data, error } = await db.rpc('driver_route_progress');
  if (error) throw error;
  return (data ?? []) as DriverRouteStop[];
}

/** Roster totals for the dashboard cards (no full-roster fetch). */
export async function countDriverBookings(
  db: SupabaseClient,
): Promise<{ total: number; confirmed: number }> {
  const { data, error } = await db.rpc('driver_bookings_count');
  if (error) throw error;
  const row = (data ?? [])[0] as { total: number; confirmed: number } | undefined;
  return { total: Number(row?.total ?? 0), confirmed: Number(row?.confirmed ?? 0) };
}
