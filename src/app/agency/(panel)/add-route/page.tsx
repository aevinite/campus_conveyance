import { createClient } from '@/lib/supabase/server';
import { getMyAgency, listMyServices, listMyBuses } from '@/features/agency/repository';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RouteForm } from './route-form';

export default async function AddRoutePage() {
  const db = await createClient();
  const agency = await getMyAgency(db);
  const [services, buses] = await Promise.all([
    agency ? listMyServices(db, agency.id) : Promise.resolve([]),
    agency ? listMyBuses(db, agency.id) : Promise.resolve([]),
  ]);

  // The colleges the agency serves (deduped) — the route's end location.
  const collegeMap = new Map<string, string>();
  for (const s of services) collegeMap.set(s.institutionId, s.institutionName);
  const colleges = [...collegeMap.entries()].map(([id, name]) => ({ id, name }));

  // A bus can only be on one route — hide buses already assigned to a route.
  const usedVehicleIds = new Set<string>();
  if (agency) {
    const { data: used } = await db
      .from('routes')
      .select('vehicle_id')
      .eq('agency_id', agency.id)
      .not('vehicle_id', 'is', null);
    for (const r of used ?? []) if (r.vehicle_id) usedVehicleIds.add(r.vehicle_id as string);
  }
  const availableBuses = buses.filter((b) => !usedVehicleIds.has(b.id));

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Add Bus Route</h1>
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
