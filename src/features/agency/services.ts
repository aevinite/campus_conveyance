import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '@/lib/errors/app-error';
import type { RouteInput } from './schemas';

export async function confirmBooking(db: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await db.rpc('confirm_booking', { p_booking_id: bookingId });
  if (error) throw new AppError('BOOKING', error.message);
}

export async function rejectBooking(db: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await db.rpc('reject_booking', { p_booking_id: bookingId });
  if (error) throw new AppError('BOOKING', error.message);
}

export interface RouteStopInput {
  name: string;
  description: string;
  lat: number;
  lng: number;
  address: string | null;
}

/** Rupees → paise, or null when the plan wasn't priced. */
const cents = (rupees: number | null | undefined): number | null =>
  rupees != null && rupees > 0 ? Math.round(rupees * 100) : null;

export async function addRoute(
  db: SupabaseClient,
  agencyId: string,
  input: RouteInput,
  agencyServiceId: string | null,
  stops: RouteStopInput[],
): Promise<void> {
  const { error } = await db.rpc('add_route', {
    p_agency_id: agencyId,
    p_agency_service_id: agencyServiceId,
    p_institution_id: input.institutionId,
    p_vehicle_id: input.vehicleId,
    // No start-location field — the route is named after its first pickup stop.
    p_start_location: stops[0]?.name ?? 'Route',
    p_price_monthly_cents: cents(input.priceMonthly),
    p_price_semester_cents: cents(input.priceSemester),
    p_price_yearly_cents: cents(input.priceYearly),
    p_departure_time: input.departureTime,
    p_image_url: input.imageUrl || null,
    p_stops: stops,
  });
  if (error) throw new AppError('ROUTE', error.message);
}

export interface RoutePlanRupees {
  priceMonthly?: number;
  priceSemester?: number;
  priceYearly?: number;
}

/** Edit a route's plan prices/time; replace stops when the route has no bookings. */
export async function updateRoute(
  db: SupabaseClient,
  routeId: string,
  prices: RoutePlanRupees,
  departureTime: string,
  stops: RouteStopInput[],
): Promise<boolean> {
  const { data, error } = await db.rpc('update_route', {
    p_route_id: routeId,
    p_price_monthly_cents: cents(prices.priceMonthly),
    p_price_semester_cents: cents(prices.priceSemester),
    p_price_yearly_cents: cents(prices.priceYearly),
    p_departure_time: departureTime,
    p_stops: stops,
  });
  if (error) throw new AppError('ROUTE', error.message);
  return Boolean(data);
}
