import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Route as RouteIcon, Search } from 'lucide-react';
import {
  resolveInstitutionId,
  listRoutesForInstitution,
  INSTITUTION_PAGE_SIZE,
} from '@/features/institution/repository';
import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { Pager, pageParams } from '@/components/pager';
import { Input } from '@/components/ui/input';
import { formatTime } from '@/lib/format-date';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const TYPES = ['ALL', 'BUS', 'VAN'] as const;

function inr(cents: number | null): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export default async function InstitutionRoutesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; type?: string }>;
}) {
  const { page: pageParam, q, type: typeParam } = await searchParams;
  const institutionId = await resolveInstitutionId();
  const type = TYPES.includes((typeParam ?? 'ALL').toUpperCase() as (typeof TYPES)[number])
    ? ((typeParam ?? 'ALL').toUpperCase() as (typeof TYPES)[number])
    : 'ALL';
  const { page, offset } = pageParams(pageParam, INSTITUTION_PAGE_SIZE);

  const { rows, total } = institutionId
    ? await listRoutesForInstitution(institutionId, {
        query: q,
        vehicleType: type === 'ALL' ? undefined : type,
        limit: INSTITUTION_PAGE_SIZE,
        offset,
      })
    : { rows: [], total: 0 };
  const totalPages = Math.max(1, Math.ceil(total / INSTITUTION_PAGE_SIZE));
  if (total > 0 && page > totalPages) {
    const sp = new URLSearchParams({ page: String(totalPages) });
    if (q) sp.set('q', q);
    if (type !== 'ALL') sp.set('type', type);
    redirect(`/institution/routes?${sp}`);
  }

  return (
    <section className="space-y-4">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <RouteIcon className="size-3.5" />
          Routes
        </span>
        <h1 className="mt-1 text-2xl font-heading font-bold tracking-tight sm:text-3xl">Routes serving your campus</h1>
        <p className="text-muted-foreground">
          Every active route to your campus across all approved agencies ({total}).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <form className="relative flex-1 sm:max-w-xs" action="/institution/routes">
          {type !== 'ALL' && <input type="hidden" name="type" value={type} />}
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={q ?? ''} placeholder="Search route or agency" className="pl-9" />
        </form>
        <div className="flex flex-wrap gap-2">
          {TYPES.map((t) => {
            const sp = new URLSearchParams();
            if (t !== 'ALL') sp.set('type', t);
            if (q) sp.set('q', q);
            const href = sp.toString() ? `/institution/routes?${sp}` : '/institution/routes';
            return (
              <Link
                key={t}
                href={href}
                aria-current={type === t ? 'page' : undefined}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm transition-colors',
                  type === t
                    ? 'border-primary bg-primary/10 font-medium text-primary'
                    : 'border-border text-muted-foreground hover:bg-muted',
                )}
              >
                {t === 'ALL' ? 'All' : t.charAt(0) + t.slice(1).toLowerCase()}
              </Link>
            );
          })}
        </div>
      </div>

      <DataTable
        headers={['Route', 'Agency', 'Type', 'Bus', 'Departs', 'Price', 'Seats (free / total)']}
        rows={rows.map((r) => [
          <span key="n" className="font-medium">{r.name}</span>,
          r.agencyName ?? <span className="text-muted-foreground">Campus route</span>,
          <StatusBadge key="t" value={r.vehicleType} tone="blue" />,
          r.busNumber ?? '—',
          r.departureTime ? formatTime(r.departureTime) : '—',
          <span key="p" className="tnum">{inr(r.price_cents)}</span>,
          <span key="s" className="tnum">
            <span className={r.available === 0 ? 'text-destructive' : 'text-foreground'}>{r.available}</span>
            <span className="text-muted-foreground"> / {r.total}</span>
          </span>,
        ])}
        empty="No routes serve your campus yet."
      />
      <Pager
        page={page}
        totalPages={totalPages}
        basePath="/institution/routes"
        params={{ q, type: type === 'ALL' ? undefined : type }}
      />
    </section>
  );
}
