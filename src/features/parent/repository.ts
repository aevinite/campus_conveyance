import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '@/lib/errors/app-error';

export interface ChildRow {
  student_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  grade: string | null;
  address: string | null;
  institution_id: string | null;
  institution_name: string | null;
  /** True for a parent-created child with no login (details live on the row). */
  managed: boolean;
  /** The child's single active booking, if any (for the status chip + CTA). */
  active_booking_id: string | null;
  active_status: string | null;
  active_route_id: string | null;
  active_route_name: string | null;
}

/** A child's single active booking — powers the parent booking page's resume/
 *  pay/blocked states (mirrors getMyActiveBooking, but for a linked child). */
export interface ChildActiveBooking {
  booking_id: string;
  status: string;
  is_paid: boolean;
  approved_at: string | null;
  expires_at: string | null;
  pickup_stop_id: string | null;
  billing_period: string | null;
  route_id: string | null;
  route_name: string | null;
}

export async function getChildActiveBooking(
  db: SupabaseClient,
  studentId: string,
): Promise<ChildActiveBooking | null> {
  const { data, error } = await db.rpc('parent_child_active_booking', {
    p_student_id: studentId,
  });
  if (error) throw new AppError('PARENT', error.message);
  const row = (Array.isArray(data) ? data[0] : data) as ChildActiveBooking | undefined;
  if (!row) return null;
  // An expired, unpaid PENDING hold still reads as active until the cron/reserve
  // sweep clears it — treat it as "no active booking" so a fresh request is
  // allowed (same rule as getMyActiveBooking on the student side).
  if (
    row.status === 'PENDING' &&
    !row.is_paid &&
    row.expires_at &&
    new Date(row.expires_at).getTime() <= Date.now()
  ) {
    return null;
  }
  return row;
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
  /** True when today's driver is a substitute (the agency changed it). */
  driver_changed: boolean;
  route_id: string | null;
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
