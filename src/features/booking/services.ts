import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReserveInput, StudentDetailsInput } from './schemas';
import { AppError } from '@/lib/errors/app-error';

export interface ReserveResult {
  id: string;
  status: string;
  /** Set once the request is auto-approved (a held seat). Null while waitlisted. */
  approvedAt: string | null;
  /** Payment deadline (approval + 20 min); null while waitlisted. */
  expiresAt: string | null;
}

export interface StudentDetails {
  fullName: string;
  phone: string;
  address: string;
  grade: string;
  guardianName: string;
  guardianPhone: string;
}

/** Read the signed-in student's saved details (via security-definer RPC). */
export async function getStudentDetails(db: SupabaseClient): Promise<StudentDetails> {
  const { data, error } = await db.rpc('get_student_details');
  if (error) throw new AppError('BOOKING', error.message);
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        full_name: string | null;
        phone: string | null;
        address: string | null;
        grade: string | null;
        guardian_name: string | null;
        guardian_phone: string | null;
      }
    | undefined;
  return {
    fullName: row?.full_name ?? '',
    phone: row?.phone ?? '',
    address: row?.address ?? '',
    grade: row?.grade ?? '',
    guardianName: row?.guardian_name ?? '',
    guardianPhone: row?.guardian_phone ?? '',
  };
}

/** Save the signed-in student's details (upsert students row + profile). */
export async function saveStudentDetails(
  db: SupabaseClient,
  input: StudentDetailsInput,
): Promise<void> {
  const { error } = await db.rpc('save_student_details', {
    p_full_name: input.fullName,
    p_phone: input.phone,
    p_address: input.address,
    p_grade: input.grade ?? '',
    p_guardian_name: input.guardianName ?? '',
    p_guardian_phone: input.guardianPhone ?? '',
  });
  if (error) throw new AppError('BOOKING', error.message);
}

/** Confirm a held (PENDING) booking after a (simulated) successful payment. */
export async function payBooking(db: SupabaseClient, bookingId: string): Promise<string> {
  const { data, error } = await db.rpc('pay_booking', { p_booking_id: bookingId });
  // Preserve the SQLSTATE (e.g. P0008 window-expired, P0005 no-longer-payable) so
  // the UI can branch on the code instead of the message text.
  if (error) throw new AppError('BOOKING', error.message, 400, error.code);
  return (data?.status as string) ?? 'CONFIRMED';
}

export async function reserveSeat(
  db: SupabaseClient,
  input: ReserveInput,
): Promise<ReserveResult> {
  const { data, error } = await db.rpc('reserve_seat', {
    p_route_id: input.routeId,
    p_pickup_stop_id: input.pickupStopId,
    // Drop-off is the campus itself — no route_stop row for it, so store null.
    p_drop_stop_id: input.dropStopId ? input.dropStopId : null,
  });
  if (error) throw new AppError('BOOKING', error.message);
  return {
    id: data.id as string,
    status: data.status as string,
    approvedAt: (data.approved_at as string) ?? null,
    expiresAt: (data.expires_at as string) ?? null,
  };
}

export async function cancelBooking(
  db: SupabaseClient,
  bookingId: string,
): Promise<void> {
  const { error } = await db.rpc('cancel_booking', { p_booking_id: bookingId });
  if (error) throw new AppError('BOOKING', error.message);
}
