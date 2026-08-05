import { Radio, Bus } from 'lucide-react';
import { resolveInstitutionId, liveBusesForInstitution } from '@/features/institution/repository';
import { DataTable } from '@/components/data-table';
import { relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function InstitutionLivePage() {
  const institutionId = await resolveInstitutionId();
  const buses = institutionId ? await liveBusesForInstitution(institutionId) : [];

  return (
    <section className="space-y-4">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <Radio className="size-3.5" />
          Live
        </span>
        <h1 className="mt-1 text-2xl font-heading font-bold tracking-tight sm:text-3xl">Live buses to campus</h1>
        <p className="text-muted-foreground">
          Buses and vans on your campus routes that are online right now. Reload to refresh.
        </p>
      </div>

      <div className="space-y-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Bus className="size-5 text-primary" /> Online now ({buses.length})
        </h2>
        <DataTable
          headers={['Bus / Van', 'Route', 'Driver', 'Coordinates', 'Last ping']}
          rows={buses.map((b) => [
            <div key="b" className="min-w-0">
              <p className="font-semibold">{b.busNumber ?? '—'}</p>
              <p className="font-mono text-xs text-muted-foreground">{b.registration_no ?? '—'}</p>
            </div>,
            b.routeName,
            b.driverName ?? '—',
            b.lat != null && b.lng != null ? (
              <span key="c" className="font-mono text-xs">
                {b.lat.toFixed(5)}, {b.lng.toFixed(5)}
              </span>
            ) : (
              '—'
            ),
            b.updated_at ? relativeTime(b.updated_at) : '—',
          ])}
          empty="No buses on your campus routes are online right now."
        />
      </div>
    </section>
  );
}
