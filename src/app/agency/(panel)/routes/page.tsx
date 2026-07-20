import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus } from 'lucide-react';
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
          <h1 className="text-2xl font-semibold">Your routes</h1>
          <p className="text-muted-foreground">
            Routes you&apos;ve added. Click Edit to change the price, time or pickup stops.
          </p>
        </div>
        <Link href="/agency/add-route" className={buttonVariants({ size: 'sm', className: 'gap-1.5' })}>
          <Plus className="size-4" />
          Add route
        </Link>
      </div>

      {routes.length === 0 ? (
        <p className="rounded-lg border border-border bg-card/40 p-6 text-sm text-muted-foreground">
          No routes added yet. Use “Add route” to create your first one.
        </p>
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
