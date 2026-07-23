import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus, Route } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getMyAgency, listMyRoutesFull, countMyRoutesFull } from '@/features/agency/repository';
import { buttonVariants } from '@/components/ui/button';
import { Pager, pageParams } from '@/components/pager';
import { EditableRouteCard } from './editable-route-card';

const PAGE_SIZE = 10;

export default async function AgencyRoutesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, PAGE_SIZE);
  const db = await createClient();
  const agency = await getMyAgency(db);
  const [routes, total] = agency
    ? await Promise.all([
        listMyRoutesFull(db, agency.id, { limit: PAGE_SIZE, offset }),
        countMyRoutesFull(db, agency.id),
      ])
    : [[], 0];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/agency/routes?page=${totalPages}`);

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">Routes</span>
          <h1 className="mt-1 text-2xl font-heading font-bold tracking-tight sm:text-3xl">Your routes</h1>
          <p className="mt-1 text-muted-foreground">
            Routes you&apos;ve added. Click Edit to change the price, time or pickup stops.
          </p>
        </div>
        <Link
          href="/agency/add-route"
          className={buttonVariants({ size: 'sm', className: 'w-full gap-1.5 sm:w-auto' })}
        >
          <Plus className="size-4" />
          Add route
        </Link>
      </div>

      {routes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card/40 p-10 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Route className="size-6" />
          </span>
          <div>
            <p className="font-medium">No routes added yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Use “Add route” to create your first one.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {routes.map((r) => (
            <EditableRouteCard key={r.id} route={r} />
          ))}
          <Pager page={page} totalPages={totalPages} basePath="/agency/routes" />
        </div>
      )}
    </section>
  );
}
