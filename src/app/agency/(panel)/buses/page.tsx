import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getMyAgency, listMyBusesFull, countMyBusesFull, listUnassignedDrivers } from '@/features/agency/repository';
import { buttonVariants } from '@/components/ui/button';
import { Pager, pageParams } from '@/components/pager';
import { EditableBusCard } from './editable-bus-card';

const PAGE_SIZE = 10;

export default async function AgencyBusesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, PAGE_SIZE);
  const db = await createClient();
  const agency = await getMyAgency(db);
  const [buses, total, unassigned] = await Promise.all([
    agency ? listMyBusesFull(db, agency.id, { limit: PAGE_SIZE, offset }) : Promise.resolve([]),
    agency ? countMyBusesFull(db, agency.id) : Promise.resolve(0),
    agency ? listUnassignedDrivers(db, agency.id) : Promise.resolve([]),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/agency/buses?page=${totalPages}`);
  // Substitute pool: active registered drivers not permanently assigned to a bus.
  // (Each card reconstructs its own current-driver option from the bus row, so we
  // don't hand every card the whole agency roster.)
  const substituteDrivers = unassigned.map((d) => ({
    id: d.driver_id,
    name: d.name,
    phone: d.phone,
  }));

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
            <EditableBusCard key={b.id} bus={b} substituteDrivers={substituteDrivers} />
          ))}
          <Pager page={page} totalPages={totalPages} basePath="/agency/buses" />
        </div>
      )}
    </section>
  );
}
