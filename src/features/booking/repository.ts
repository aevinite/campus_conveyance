import type { SupabaseClient } from '@supabase/supabase-js';

export interface RouteSummary {
  id: string;
  name: string;
}
export interface Stop {
  id: string;
  name: string;
  sequence: number;
}
export interface Availability {
  total: number;
  reserved: number;
  available: number;
}
export interface BookingRow {
  id: string;
  status: string;
  created_at: string;
  routeName: string;
}

/** Routes for the caller's institution (RLS-scoped). */
export async function listRoutes(db: SupabaseClient): Promise<RouteSummary[]> {
  const { data, error } = await db
    .from('routes')
    .select('id, name')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return (data ?? []) as RouteSummary[];
}

export async function getRouteWithStops(
  db: SupabaseClient,
  routeId: string,
): Promise<{ route: RouteSummary; stops: Stop[] } | null> {
  const { data: route } = await db
    .from('routes')
    .select('id, name')
    .eq('id', routeId)
    .maybeSingle();
  if (!route) return null;
  const { data: stops } = await db
    .from('route_stops')
    .select('id, name, sequence')
    .eq('route_id', routeId)
    .order('sequence');
  return { route: route as RouteSummary, stops: (stops ?? []) as Stop[] };
}

export async function getAvailability(
  db: SupabaseClient,
  routeId: string,
): Promise<Availability> {
  const { data } = await db
    .from('seat_allocations')
    .select('total_seats, reserved_seats, route_assignments!inner(route_id)')
    .eq('route_assignments.route_id', routeId)
    .limit(1)
    .maybeSingle();
  const total = (data?.total_seats as number) ?? 0;
  const reserved = (data?.reserved_seats as number) ?? 0;
  return { total, reserved, available: Math.max(total - reserved, 0) };
}

export async function listMyBookings(db: SupabaseClient): Promise<BookingRow[]> {
  const { data, error } = await db
    .from('bookings')
    .select('id, status, created_at, routes(name)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((b) => {
    const routes = b.routes as { name: string } | { name: string }[] | null;
    const routeName = Array.isArray(routes) ? routes[0]?.name : routes?.name;
    return {
      id: b.id as string,
      status: b.status as string,
      created_at: b.created_at as string,
      routeName: routeName ?? 'Route',
    };
  });
}
