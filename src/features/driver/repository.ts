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
}

/** The signed-in driver's own profile (null if the account isn't a driver). */
export async function getDriverProfile(db: SupabaseClient): Promise<DriverProfile | null> {
  const { data, error } = await db.rpc('driver_profile');
  if (error) throw error;
  return ((data ?? [])[0] as DriverProfile) ?? null;
}

export async function listDriverBuses(db: SupabaseClient): Promise<DriverBus[]> {
  const { data, error } = await db.rpc('driver_buses');
  if (error) throw error;
  return (data ?? []) as DriverBus[];
}

export async function listDriverBookings(db: SupabaseClient): Promise<DriverBooking[]> {
  const { data, error } = await db.rpc('driver_bookings');
  if (error) throw error;
  return (data ?? []) as DriverBooking[];
}
