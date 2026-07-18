'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, ArrowRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { InstitutionLogo } from '@/components/institution-logo';
import { VerifiedBadge } from '@/components/verified-badge';
import type { Institution, Kind } from '@/features/catalog/repository';

type Filter = 'ALL' | Kind;

const TABS: { key: Filter; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'SCHOOL', label: 'Schools' },
  { key: 'COLLEGE', label: 'Colleges' },
];

export function CatalogBrowser({ institutions }: { institutions: Institution[] }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [asc, setAsc] = useState(true);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return institutions
      .filter((i) => filter === 'ALL' || i.kind === filter)
      .filter((i) => !q || i.name.toLowerCase().includes(q))
      .sort((a, b) => (asc ? 1 : -1) * a.name.localeCompare(b.name));
  }, [institutions, query, filter, asc]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search schools & colleges…"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
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
          <button
            onClick={() => setAsc((v) => !v)}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            title="Toggle sort order"
          >
            {asc ? 'A→Z' : 'Z→A'}
          </button>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="text-muted-foreground">No campuses match your search.</p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((i) => (
            <Link
              key={i.id}
              href={`/student/schools/${i.id}`}
              className="group overflow-hidden rounded-2xl border border-border bg-card transition-all hover:-translate-y-1 hover:shadow-sm"
            >
              <div
                className="relative flex h-24 items-end px-5"
                style={{
                  background:
                    'linear-gradient(135deg, color-mix(in oklch, var(--primary) 26%, transparent), color-mix(in oklch, var(--chart-5) 24%, transparent))',
                }}
              >
                <div aria-hidden className="absolute inset-0 opacity-60 bg-grid" />
                <InstitutionLogo
                  name={i.name}
                  kind={i.kind}
                  imageUrl={i.image_url}
                  className="relative -mb-8 size-16 ring-2 ring-background"
                  iconClassName="size-7"
                />
              </div>
              <div className="space-y-1.5 p-5 pt-10">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {i.kind === 'COLLEGE' ? 'College' : 'School'}
                </span>
                <h2 className="flex items-center gap-1.5 font-semibold">
                  {i.name}
                  <VerifiedBadge verified={i.is_verified} />
                </h2>
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {i.description}
                </p>
                <span className="inline-flex items-center gap-1 pt-1 text-sm font-medium text-primary">
                  View campus
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
