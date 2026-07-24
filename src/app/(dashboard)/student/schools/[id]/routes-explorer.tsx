'use client';
import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { Search, ArrowRight, ArrowLeft, Bus, Truck, Clock, IdCard } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { CampusRoute, VehicleType } from '@/features/catalog/repository';

type Filter = 'ALL' | VehicleType;

const TABS: { key: Filter; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'BUS', label: 'Buses' },
  { key: 'VAN', label: 'Vans' },
];

const inr = (cents: number | null) =>
  cents == null || cents === 0
    ? null
    : `₹${Math.round(cents / 100).toLocaleString('en-IN')}`;

// departure_time comes as "HH:MM:SS" — show it as a friendly local time.
function fmtTime(t: string | null): string | null {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const am = h < 12;
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${am ? 'AM' : 'PM'}`;
}

function seatsPill(r: CampusRoute) {
  if (r.total === 0)
    return <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">Seats not set</span>;
  if (r.available === 0)
    return <span className="rounded-full border border-warning/30 bg-warning/10 px-2.5 py-0.5 text-xs font-semibold text-warning">Full — waitlist open</span>;
  const low = r.available <= 5;
  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
        low
          ? 'border-warning/30 bg-warning/10 text-warning'
          : 'border-success/30 bg-success/10 text-success'
      }`}
    >
      <span className="tnum">{r.available}</span> of <span className="tnum">{r.total}</span> seats left
    </span>
  );
}

// Server-paginated + searched (migration 0068). This component only drives
// navigation (search / type / page live in the URL) and renders one page.
export function RoutesExplorer({
  routes,
  query,
  vehicleType,
  page,
  totalPages,
}: {
  routes: CampusRoute[];
  query: string;
  vehicleType: Filter;
  page: number;
  totalPages: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [text, setText] = useState(query);
  const [isPending, startTransition] = useTransition();

  const urlFor = (next: Partial<{ q: string; type: Filter; page: number }>) => {
    const q = next.q ?? query;
    const t = next.type ?? vehicleType;
    const p = next.page ?? 1;
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (t !== 'ALL') params.set('type', t);
    if (p > 1) params.set('page', String(p));
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  const go = (next: Parameters<typeof urlFor>[0]) =>
    startTransition(() => router.replace(urlFor(next)));

  // Sync the local search box when the URL-driven query changes — intentional.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setText(query), [query]);
  useEffect(() => {
    if (text.trim() === query) return;
    const h = setTimeout(() => go({ q: text.trim(), page: 1 }), 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div className={`space-y-4 transition-opacity ${isPending ? 'opacity-60' : ''}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search routes or agencies…"
            aria-label="Search routes or agencies"
            className="pl-9"
          />
        </div>
        <div className="flex rounded-lg border border-border p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-pressed={vehicleType === t.key}
              onClick={() => go({ type: t.key, page: 1 })}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                vehicleType === t.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {routes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border py-16 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
            <Bus className="size-6" />
          </span>
          <p className="font-semibold">No rides found</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            {query || vehicleType !== 'ALL'
              ? 'No rides match your search — try a different name or clear the filters.'
              : 'No rides serve this campus yet — check back soon.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {routes.map((r) => {
            const fare = inr(r.price_cents);
            const time = fmtTime(r.departureTime);
            const Icon = r.vehicleType === 'VAN' ? Truck : Bus;
            return (
              <Link
                key={r.id}
                href={`/student/routes/${r.id}`}
                className="group flex items-center gap-4 rounded-2xl border border-border bg-card/60 p-4 shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-card hover:shadow-md sm:p-5"
              >
                <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <Icon className="size-6" />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-semibold">
                    {r.name}
                    {r.isAc != null && (
                      <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                        {r.isAc ? 'AC' : 'Non-AC'}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
                    {r.agencyName && <span>{r.agencyName}</span>}
                    {r.busNumber && (
                      <span className="inline-flex items-center gap-1">
                        <IdCard className="size-3.5" /> Bus {r.busNumber}
                      </span>
                    )}
                    {time && (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3.5" /> {time}
                      </span>
                    )}
                  </p>
                  <div className="mt-1.5">{seatsPill(r)}</div>
                </div>

                <div className="shrink-0 text-right">
                  {fare && <p className="tnum text-lg font-bold">{fare}</p>}
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
                    {r.total > 0 && r.available === 0 ? 'Waitlist' : 'View & book'}
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          {page > 1 ? (
            <Link
              href={urlFor({ page: page - 1 })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
            >
              <ArrowLeft className="size-4" /> Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-muted-foreground">
            Page <span className="tnum font-semibold text-foreground">{page}</span> of{' '}
            <span className="tnum">{totalPages}</span>
          </span>
          {page < totalPages ? (
            <Link
              href={urlFor({ page: page + 1 })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
            >
              Next <ArrowRight className="size-4" />
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
