import Link from 'next/link';
import { Plus } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getMyAgency, listMyBusesFull, listMyDrivers } from '@/features/agency/repository';
import { buttonVariants } from '@/components/ui/button';
import { EditableBusCard } from './editable-bus-card';

export default async function AgencyBusesPage() {
  const db = await createClient();
  const agency = await getMyAgency(db);
  const [buses, driverRows] = await Promise.all([
    agency ? listMyBusesFull(db, agency.id) : Promise.resolve([]),
    agency ? listMyDrivers(db, agency.id) : Promise.resolve([]),
  ]);
  const drivers = driverRows.map((d) => ({ id: d.driver_id, name: d.name ?? d.email ?? 'Driver' }));

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Your buses</h1>
          <p className="text-muted-foreground">
            Buses you&apos;ve added. Click a bus to edit its details or driver.
          </p>
        </div>
        <Link href="/agency/add-bus" className={buttonVariants({ size: 'sm', className: 'gap-1.5' })}>
          <Plus className="size-4" />
          Add bus
        </Link>
      </div>

      {buses.length === 0 ? (
        <p className="rounded-lg border border-border bg-card/40 p-6 text-sm text-muted-foreground">
          No buses added yet. Use “Add bus” to add your first one.
        </p>
      ) : (
        <div className="space-y-4">
          {buses.map((b) => (
            <EditableBusCard key={b.id} bus={b} drivers={drivers} />
          ))}
        </div>
      )}
    </section>
  );
}
