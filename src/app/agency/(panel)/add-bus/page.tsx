import { createClient } from '@/lib/supabase/server';
import { getMyAgency, listUnassignedDrivers } from '@/features/agency/repository';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BusForm } from './bus-form';

export default async function AddBusPage() {
  const db = await createClient();
  const agency = await getMyAgency(db);
  // Only active, not-soft-deleted drivers who aren't already the permanent driver
  // of another bus — same pool Edit-Bus uses (a driver drives one bus).
  const drivers = agency ? await listUnassignedDrivers(db, agency.id) : [];

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Add New Bus</h1>
      <Card>
        <CardHeader>
          <CardTitle>Bus &amp; driver details</CardTitle>
        </CardHeader>
        <CardContent>
          <BusForm
            drivers={drivers.map((d) => ({ id: d.driver_id, name: d.name }))}
          />
        </CardContent>
      </Card>
    </section>
  );
}
