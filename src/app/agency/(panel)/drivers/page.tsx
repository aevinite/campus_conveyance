import { createClient } from '@/lib/supabase/server';
import { getMyAgency, listMyDrivers } from '@/features/agency/repository';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DriverForm } from './driver-form';
import { EditableDriverCard } from './editable-driver-card';

export default async function AgencyDriversPage() {
  const db = await createClient();
  const agency = await getMyAgency(db);
  const drivers = agency ? await listMyDrivers(db, agency.id) : [];

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Drivers</h1>
        <p className="text-muted-foreground">
          Create login accounts for your drivers. Drivers can&apos;t sign up themselves — you set their email
          &amp; password here, then share it so they can log in to the driver panel.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Create a driver account</CardTitle>
          </CardHeader>
          <CardContent>
            <DriverForm />
          </CardContent>
        </Card>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Your drivers</h2>
          {drivers.length === 0 ? (
            <p className="rounded-lg border border-border bg-card/40 p-6 text-sm text-muted-foreground">
              No drivers yet.
            </p>
          ) : (
            <div className="space-y-3">
              {drivers.map((d) => (
                <EditableDriverCard key={d.driver_id} driver={d} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
