'use server';
import { createClient } from '@/lib/supabase/server';
import { getSiteUrl } from '@/lib/site-url';

/**
 * The scan link for a booking's ride-pass QR. Only the student themself or a
 * parent of that child gets it (enforced in the my_ride_pass_token RPC, 0131).
 */
export async function getRidePassUrl(bookingId: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return null;
  const db = await createClient();
  const { data, error } = await db.rpc('my_ride_pass_token', { p_booking_id: bookingId });
  if (error || typeof data !== 'string' || !data) return null;
  return `${getSiteUrl()}/pass/${data}`;
}
