import Link from 'next/link';
import { UsersRound, Bus, MapPin, BellRing } from 'lucide-react';
import {
  resolveInstitutionId,
  listRidersForInstitution,
  type BoardingStatus,
  type InstitutionRiderRow,
} from '@/features/institution/repository';
import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const TYPES = ['ALL', 'BUS', 'VAN'] as const;

// Boarding stage today → rider-facing label + pill tone.
const BOARDING: Record<BoardingStatus, { label: string; tone: 'green' | 'amber' | 'gray' }> = {
  WAITING: { label: 'Waiting', tone: 'amber' },
  BOARDED: { label: 'On board', tone: 'green' },
  REACHED: { label: 'At campus', tone: 'green' },
  GOT_OFF: { label: 'Dropped', tone: 'gray' },
};

export default async function InstitutionRidersPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type: typeParam } = await searchParams;
  const institutionId = await resolveInstitutionId();
  const type = TYPES.includes((typeParam ?? 'ALL').toUpperCase() as (typeof TYPES)[number])
    ? ((typeParam ?? 'ALL').toUpperCase() as (typeof TYPES)[number])
    : 'ALL';

  const riders = institutionId
    ? await listRidersForInstitution(institutionId, { vehicleType: type === 'ALL' ? undefined : type })
    : [];

  // Group by route, preserving the run-sheet order the repository sorted into.
  const groups = new Map<string, { name: string; vehicleType: string; busNumber: string | null; rows: InstitutionRiderRow[] }>();
  for (const r of riders) {
    if (!groups.has(r.routeId)) {
      groups.set(r.routeId, { name: r.routeName, vehicleType: r.vehicleType, busNumber: r.busNumber, rows: [] });
    }
    groups.get(r.routeId)!.rows.push(r);
  }

  return (
    <section className="space-y-5">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <UsersRound className="size-3.5" />
          Riders
        </span>
        <h1 className="mt-1 text-2xl font-heading font-bold tracking-tight sm:text-3xl">Riders &amp; boarding status</h1>
        <p className="text-muted-foreground">
          Students riding to your campus by bus or van, their pickup stop, and today&apos;s live status. Grouped by
          route in pickup order — reload to refresh.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TYPES.map((t) => (
          <Link
            key={t}
            href={t === 'ALL' ? '/institution/riders' : `/institution/riders?type=${t}`}
            aria-current={type === t ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-1 text-sm transition-colors',
              type === t
                ? 'border-primary bg-primary/10 font-medium text-primary'
                : 'border-border text-muted-foreground hover:bg-muted',
            )}
          >
            {t === 'ALL' ? 'All' : t === 'BUS' ? 'Bus' : 'Van'}
          </Link>
        ))}
      </div>

      {groups.size === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-14 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
            <UsersRound className="size-6" />
          </span>
          <p className="font-medium">No riders yet</p>
          <p className="text-sm text-muted-foreground">Students who book a ride to your campus will appear here.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {[...groups.values()].map((g) => (
            <div key={g.name} className="space-y-2">
              <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                <Bus className="size-5 text-primary" />
                {g.name}
                <StatusBadge value={g.vehicleType} tone="blue" />
                {g.busNumber && <span className="text-sm font-normal text-muted-foreground">Bus {g.busNumber}</span>}
                <span className="text-sm font-normal text-muted-foreground">· {g.rows.length} rider{g.rows.length === 1 ? '' : 's'}</span>
              </h2>
              <DataTable
                headers={['#', 'Student', 'Pickup stop', 'Booking', 'Stop status', 'Boarding']}
                rows={g.rows.map((r, i) => [
                  <span key="seq" className="tnum text-muted-foreground">
                    {r.pickupSequence ?? i + 1}
                  </span>,
                  <div key="st" className="min-w-0">
                    <p className="font-medium">{r.studentName ?? '—'}</p>
                    {r.studentEmail && <p className="text-xs text-muted-foreground">{r.studentEmail}</p>}
                  </div>,
                  <span key="stop" className="inline-flex items-center gap-1.5 text-sm">
                    <MapPin className="size-3.5 text-muted-foreground" />
                    {r.pickupStop}
                  </span>,
                  <StatusBadge key="bk" value={r.bookingStatus} />,
                  <span key="ss" className="flex flex-wrap items-center gap-1.5">
                    {r.stopStatus === 'NEXT' && <StatusBadge value="Bus heading here" tone="amber" />}
                    {r.stopStatus === 'SKIPPED' && <StatusBadge value="Stop skipped" tone="red" />}
                    {!r.stopStatus && <span className="text-sm text-muted-foreground">—</span>}
                    {r.approaching && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/25 bg-sky-500/12 px-2 py-0.5 text-xs font-medium text-sky-600 dark:text-sky-400">
                        <BellRing className="size-3" /> Approaching
                      </span>
                    )}
                  </span>,
                  <StatusBadge key="brd" value={BOARDING[r.boarding].label} tone={BOARDING[r.boarding].tone} />,
                ])}
                empty="No riders on this route."
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
