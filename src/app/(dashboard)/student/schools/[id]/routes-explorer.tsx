'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, ArrowRight, Bus, Truck, Clock, IdCard } from 'lucide-react';
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
    return <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">Seats not set</span>;
  if (r.available === 0)
    return <span className="rounded-full border border-warning/30 bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning">Full — waitlist open</span>;
  const low = r.available <= 5;
  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        low
          ? 'border-warning/30 bg-warning/10 text-warning'
          : 'border-success/30 bg-success/10 text-success'
      }`}
    >
      {r.available} of {r.total} seats left
    </span>
  );
}

export function RoutesExplorer({ routes }: { routes: CampusRoute[] }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return routes
      .filter((r) => filter === 'ALL' || r.vehicleType === filter)
      .filter(
        (r) =>
          !q ||
          r.name.toLowerCase().includes(q) ||
          (r.agencyName ?? '').toLowerCase().includes(q),
      );
  }, [routes, query, filter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search routes or agencies…"
            className="pl-9"
          />
        </div>
        <div className="flex rounded-lg border border-border p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                filter === t.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">
          {routes.length === 0
            ? 'No rides serve this campus yet — check back soon.'
            : 'No rides match your search.'}
        </p>
      ) : (
        <div className="space-y-3">
          {shown.map((r) => {
            const fare = inr(r.price_cents);
            const time = fmtTime(r.departureTime);
            const Icon = r.vehicleType === 'VAN' ? Truck : Bus;
            return (
              <Link
                key={r.id}
                href={`/student/routes/${r.id}`}
                className="group flex items-center gap-4 rounded-2xl border border-border bg-card/60 p-4 transition-all hover:-translate-y-0.5 hover:bg-card hover:shadow-sm sm:p-5"
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
                  {fare && <p className="text-lg font-bold">{fare}</p>}
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
    </div>
  );
}
