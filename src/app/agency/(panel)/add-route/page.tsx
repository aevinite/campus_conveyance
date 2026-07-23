import { createClient } from '@/lib/supabase/server';
import { getMyAgency, listMyServices, listMyBuses } from '@/features/agency/repository';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RouteForm } from './route-form';

export default async function AddRoutePage() {
  const db = await createClient();
  const agency = await getMyAgency(db);
  // All three reads only depend on agency.id — fetch them together, not in series.
  const [services, buses, usedRes] = await Promise.all([
    agency ? listMyServices(db, agency.id) : Promise.resolve([]),
    agency ? listMyBuses(db, agency.id) : Promise.resolve([]),
    agency
      ? db.from('routes').select('vehicle_id').eq('agency_id', agency.id).not('vehicle_id', 'is', null)
      : Promise.resolve({ data: [] as { vehicle_id: string | null }[] }),
  ]);

  // The colleges the agency serves (deduped) — the route's end location.
  const collegeMap = new Map<string, string>();
  for (const s of services) collegeMap.set(s.institutionId, s.institutionName);
  const colleges = [...collegeMap.entries()].map(([id, name]) => ({ id, name }));

  // A bus can only be on one route — hide buses already assigned to a route.
  const usedVehicleIds = new Set<string>();
  for (const r of (usedRes.data ?? []) as { vehicle_id: string | null }[]) {
    if (r.vehicle_id) usedVehicleIds.add(r.vehicle_id);
  }
  const availableBuses = buses.filter((b) => !usedVehicleIds.has(b.id));

  return (
    <section className="space-y-4">
      <div>
        <span className="text-xs font-semibold uppercase tracking-widest text-primary">Routes</span>
        <h1 className="mt-1 text-2xl font-heading font-bold tracking-tight sm:text-3xl">Add bus route</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Route details</CardTitle>
        </CardHeader>
        <CardContent>
          <RouteForm
            colleges={colleges}
            busesExist={buses.length > 0}
            buses={availableBuses.map((b) => ({
              id: b.id,
              label: `${b.bus_number ? `Bus ${b.bus_number}` : 'Bus'} · ${b.is_ac ? 'AC' : 'Non-AC'} · ${b.capacity} seats${b.registration_no ? ` · ${b.registration_no}` : ''}`,
            }))}
          />
        </CardContent>
      </Card>
    </section>
  );
}
