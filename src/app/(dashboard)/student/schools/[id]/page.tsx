import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Bus, Truck, ArrowRight, Building2 } from 'lucide-react';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import {
  getInstitution,
  listAgenciesForInstitution,
  type VehicleType,
} from '@/features/catalog/repository';

export default async function SchoolDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  await requireRole('STUDENT');
  const { id } = await params;
  const { type: rawType } = await searchParams;
  const type: VehicleType = rawType === 'VAN' ? 'VAN' : 'BUS';

  const db = await createClient();
  const inst = await getInstitution(db, id);
  if (!inst) notFound();
  const agencies = await listAgenciesForInstitution(db, id, type);

  const tabs: { key: VehicleType; label: string; icon: typeof Bus }[] = [
    { key: 'BUS', label: 'Bus', icon: Bus },
    { key: 'VAN', label: 'Van', icon: Truck },
  ];

  return (
    <section className="space-y-8">
      <div>
        <Link href="/student/schools" className="text-sm text-muted-foreground underline">
          ← All campuses
        </Link>
        <div className="mt-4 overflow-hidden rounded-3xl border border-border">
          <div
            className="flex h-40 items-center justify-center"
            style={{
              background:
                'linear-gradient(135deg, oklch(0.83 0.17 85 / 0.3), oklch(0.3 0.04 80 / 0.5))',
            }}
          >
            <Building2 className="size-14 text-primary" />
          </div>
          <div className="space-y-1 p-6">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {inst.kind === 'COLLEGE' ? 'College' : 'School'}
            </span>
            <h1 className="text-2xl font-semibold">{inst.name}</h1>
            <p className="max-w-2xl text-muted-foreground">{inst.description}</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Choose your transport</h2>
          <div className="flex rounded-lg border border-border p-0.5">
            {tabs.map((t) => (
              <Link
                key={t.key}
                href={`/student/schools/${id}?type=${t.key}`}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                  type === t.key
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <t.icon className="size-4" />
                {t.label}
              </Link>
            ))}
          </div>
        </div>

        {agencies.length === 0 ? (
          <p className="text-muted-foreground">
            No {type === 'BUS' ? 'bus' : 'van'} agencies serve this campus yet.
          </p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            {agencies.map((a) => (
              <Link
                key={a.id}
                href={`/student/schools/${id}/agencies/${a.id}?type=${type}`}
                className="group flex flex-col gap-2 rounded-2xl border border-border bg-card/60 p-6 transition-all hover:-translate-y-1 hover:bg-card"
              >
                <div className="flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">
                    {type === 'BUS' ? <Bus className="size-6" /> : <Truck className="size-6" />}
                  </span>
                  <div>
                    <h3 className="font-semibold">{a.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {a.routeCount} {type === 'BUS' ? 'bus' : 'van'} route
                      {a.routeCount === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
                <p className="line-clamp-2 text-sm text-muted-foreground">{a.description}</p>
                <span className="mt-auto inline-flex items-center gap-1 pt-2 text-sm font-medium text-primary">
                  View routes
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
