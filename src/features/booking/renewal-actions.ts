'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { toErrorResponse, AppError } from '@/lib/errors/app-error';

export type RenewState = { ok?: boolean; error?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIODS = ['MONTHLY', 'SEMESTER', 'YEARLY'] as const;

/**
 * Rider (or linked parent) paid the next plan by UPI → record the UTR against the
 * SAME booking. A SUPER_ADMIN verifies it (verify_pass_renewal), which extends the
 * pass from its current end. The RPC enforces ownership + the renewal window.
 */
export async function submitPassRenewalAction(_: RenewState, formData: FormData): Promise<RenewState> {
  const bookingId = String(formData.get('bookingId') ?? '');
  const period = String(formData.get('period') ?? '');
  const utr = String(formData.get('utr') ?? '').trim();
  if (!UUID_RE.test(bookingId)) return { error: 'Missing booking.' };
  if (!(PERIODS as readonly string[]).includes(period)) return { error: 'Pick a plan.' };
  if (!/^\d{12}$/.test(utr)) return { error: 'Enter the 12-digit UPI reference (UTR).' };

  const db = await createClient();
  try {
    const { error } = await db.rpc('submit_pass_renewal', {
      p_booking_id: bookingId,
      p_period: period,
      p_utr: utr,
    });
    if (error) throw new AppError('BOOKING', error.message);
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  revalidatePath('/student');
  revalidatePath('/parent');
  return { ok: true };
}
