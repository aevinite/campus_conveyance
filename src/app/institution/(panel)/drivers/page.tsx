import { IdCard } from 'lucide-react';
import { resolveInstitutionId, listDriversForInstitution } from '@/features/institution/repository';
import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';

export const dynamic = 'force-dynamic';

export default async function InstitutionDriversPage() {
  const institutionId = await resolveInstitutionId();
  const rows = institutionId ? await listDriversForInstitution(institutionId) : [];

  return (
    <section className="space-y-4">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <IdCard className="size-3.5" />
          Drivers
        </span>
        <h1 className="mt-1 text-2xl font-heading font-bold tracking-tight sm:text-3xl">Drivers on your routes</h1>
        <p className="text-muted-foreground">
          Drivers running the buses and vans serving your campus ({rows.length}).
        </p>
      </div>

      <DataTable
        headers={['Driver', 'Contact', 'Licence no.', 'Bus / Van', 'Routes', 'Status']}
        rows={rows.map((d) => [
          <span key="n" className="font-medium">{d.name ?? '—'}</span>,
          <span key="c" className="text-sm">{d.phone ?? '—'}</span>,
          <span key="l" className="font-mono text-xs">{d.licenseNo ?? '—'}</span>,
          <div key="b" className="min-w-0 text-sm">
            <p>{d.busNumber ?? '—'}</p>
            {d.registration_no && <p className="font-mono text-xs text-muted-foreground">{d.registration_no}</p>}
          </div>,
          <span key="r" className="text-sm">{d.routeNames.length > 0 ? d.routeNames.join(', ') : '—'}</span>,
          <StatusBadge key="o" value={d.isOnline ? 'Online' : 'Offline'} />,
        ])}
        empty="No drivers run your campus routes yet."
      />
    </section>
  );
}
