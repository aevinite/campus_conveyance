import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReserveInput } from './schemas';
import { AppError } from '@/lib/errors/app-error';

export interface ReserveResult {
  id: string;
  status: string;
}

export async function reserveSeat(
  db: SupabaseClient,
  input: ReserveInput,
): Promise<ReserveResult> {
  const { data, error } = await db.rpc('reserve_seat', {
    p_route_id: input.routeId,
    p_pickup_stop_id: input.pickupStopId,
    p_drop_stop_id: input.dropStopId,
  });
  if (error) throw new AppError('BOOKING', error.message);
  return { id: data.id as string, status: data.status as string };
}

export async function cancelBooking(
  db: SupabaseClient,
  bookingId: string,
): Promise<void> {
  const { error } = await db.rpc('cancel_booking', { p_booking_id: bookingId });
  if (error) throw new AppError('BOOKING', error.message);
}
