import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Bus, Truck, ArrowRight, Phone } from 'lucide-react';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import {
  getInstitution,
  getAgency,
  listAgencyRoutes,
  type VehicleType,
} from '@/features/catalog/repository';

export default async function AgencyRoutesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; agencyId: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  await requireRole('STUDENT');
  const { id, agencyId } = await params;
  const { type: rawType } = await searchParams;
  const type: VehicleType = rawType === 'VAN' ? 'VAN' : 'BUS';

  const db = await createClient();
  const [inst, agency] = await Promise.all([
    getInstitution(db, id),
    getAgency(db, agencyId),
  ]);
  if (!inst || !agency) notFound();
  const routes = await listAgencyRoutes(db, id, agencyId, type);

  return (
    <section className="max-w-3xl space-y-8">
      <div>
        <Link
          href={`/student/schools/${id}?type=${type}`}
          className="text-sm text-muted-foreground underline"
        >
          ← {inst.name}
        </Link>
        <div className="mt-4 flex items-start gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground">
            {type === 'BUS' ? <Bus className="size-7" /> : <Truck className="size-7" />}
          </span>
          <div>
            <h1 className="text-2xl font-semibold">{agency.name}</h1>
            <p className="max-w-xl text-muted-foreground">{agency.description}</p>
            {agency.phone && (
              <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <Phone className="size-3.5" /> {agency.phone}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">
          {type === 'BUS' ? 'Bus' : 'Van'} routes at {inst.name}
        </h2>
        {routes.length === 0 ? (
          <p className="text-muted-foreground">No routes available right now.</p>
        ) : (
          <div className="space-y-3">
            {routes.map((r) => {
              const soldOut = r.available <= 0;
              return (
                <Link
                  key={r.id}
                  href={`/student/routes/${r.id}`}
                  className="group flex items-center justify-between rounded-2xl border border-border bg-card/60 p-5 transition-all hover:bg-card"
                >
                  <div>
                    <p className="font-medium">{r.name}</p>
                    <p className={`text-sm ${soldOut ? 'text-amber-500' : 'text-green-500'}`}>
                      {soldOut
                        ? `Full — ${r.total} seats`
                        : `${r.available} of ${r.total} seats available`}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
                    {soldOut ? 'Join waitlist' : 'Book'}
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
