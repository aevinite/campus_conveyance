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

/**
 * Record a rider's UPI payment (they've paid to the platform VPA and entered the
 * 12-digit UTR). The seat is HELD as "SUBMITTED" — a SUPER_ADMIN verifies the UTR
 * to actually confirm it. Returns the booking's payment_status (expected
 * 'SUBMITTED'). Never confirms the seat itself.
 */
export async function submitUpiPayment(
  db: SupabaseClient,
  input: { bookingId: string; utr: string },
): Promise<string> {
  const { data, error } = await db.rpc('submit_upi_payment', {
    p_booking_id: input.bookingId,
    p_utr: input.utr,
  });
  // Preserve the SQLSTATE (P0008 window-expired, P0005 no-longer-payable,
  // P0015 bad UTR) so the UI can branch on the code, not the message text.
  if (error) throw new AppError('BOOKING', error.message, 400, error.code);
  const status = (data?.payment_status as string | undefined) ?? undefined;
  if (!status) throw new AppError('BOOKING', 'Could not submit your payment — please try again.', 400);
  return status;
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
    p_billing_period: input.billingPeriod ?? null,
    // Null → self-booking; a uuid → a linked parent booking for that child.
    p_student_id: input.studentId ? input.studentId : null,
  });
  if (error) throw new AppError('BOOKING', error.message);
  // Guard against an empty RPC result — dereferencing data.id/.status blind would
  // NPE (or emit an undefined booking) instead of a clear error.
  if (!data?.id || !data?.status) {
    throw new AppError('BOOKING', 'Could not reserve the seat — please try again.', 400);
  }
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
  reason: string | null = null,
  refund: Record<string, string> | null = null,
): Promise<void> {
  const { error } = await db.rpc('cancel_booking', {
    p_booking_id: bookingId,
    p_reason: reason,
    p_refund: refund,
  });
  if (error) throw new AppError('BOOKING', error.message);
}
