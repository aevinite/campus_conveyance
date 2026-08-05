import { Building2 } from 'lucide-react';
import { resolveInstitutionId, listAgenciesForInstitution } from '@/features/institution/repository';
import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';

export const dynamic = 'force-dynamic';

export default async function InstitutionAgenciesPage() {
  const institutionId = await resolveInstitutionId();
  const rows = institutionId ? await listAgenciesForInstitution(institutionId) : [];

  return (
    <section className="space-y-4">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <Building2 className="size-3.5" />
          Agencies
        </span>
        <h1 className="mt-1 text-2xl font-heading font-bold tracking-tight sm:text-3xl">Agencies serving your campus</h1>
        <p className="text-muted-foreground">
          Approved transport providers running routes to your campus ({rows.length}). New requests to serve your
          campus appear under <span className="font-medium text-foreground">Agency Requests</span>.
        </p>
      </div>

      <DataTable
        headers={['Agency', 'Status', 'Vehicle types', 'Active routes']}
        rows={rows.map((a) => [
          <span key="n" className="font-medium">{a.name}</span>,
          <StatusBadge key="s" value={a.status} />,
          <span key="v" className="flex flex-wrap gap-1">
            {a.vehicleTypes.length === 0
              ? '—'
              : a.vehicleTypes.map((t) => <StatusBadge key={t} value={t} tone="blue" />)}
          </span>,
          <span key="r" className="tnum">{a.routeCount}</span>,
        ])}
        empty="No agencies serve your campus yet."
      />
    </section>
  );
}
