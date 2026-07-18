import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '@/lib/errors/app-error';

export interface ChildRow {
  student_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  grade: string | null;
  address: string | null;
}

export interface ChildBookingRow {
  booking_id: string;
  student_id: string;
  student_name: string | null;
  route_name: string | null;
  institution_name: string | null;
  status: string;
  is_paid: boolean;
  created_at: string;
  pickup_name: string | null;
  departure_time: string | null;
  bus_number: string | null;
  driver_name: string | null;
  driver_phone: string | null;
}

/** The signed-in parent's linked children (via security-definer RPC). */
export async function listChildren(db: SupabaseClient): Promise<ChildRow[]> {
  const { data, error } = await db.rpc('parent_children');
  if (error) throw new AppError('PARENT', error.message);
  return (data ?? []) as ChildRow[];
}

/** Every booking of every linked child, newest first. */
export async function listChildrenBookings(db: SupabaseClient): Promise<ChildBookingRow[]> {
  const { data, error } = await db.rpc('parent_children_bookings');
  if (error) throw new AppError('PARENT', error.message);
  return (data ?? []) as ChildBookingRow[];
}
