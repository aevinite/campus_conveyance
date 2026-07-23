'use client';
import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { Search, ArrowRight, ArrowLeft } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { InstitutionLogo } from '@/components/institution-logo';
import { VerifiedBadge } from '@/components/verified-badge';
import type { Institution, KindFilter } from '@/features/catalog/repository';

const TABS: { key: KindFilter; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'SCHOOL', label: 'Schools' },
  { key: 'COLLEGE', label: 'Colleges' },
];

// Server-paginated catalog. Search / kind / sort / page all live in the URL, so
// the server returns just the matching page — no client-side filtering of a
// full-catalog payload. This component only drives navigation + renders a page.
export function CatalogBrowser({
  institutions,
  query,
  kind,
  sort,
  page,
  totalPages,
}: {
  institutions: Institution[];
  query: string;
  kind: KindFilter;
  sort: 'asc' | 'desc';
  page: number;
  totalPages: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [text, setText] = useState(query);
  const [isPending, startTransition] = useTransition();

  // Build a URL from the current filters + overrides. Any filter change resets
  // to page 1 unless a page is explicitly passed.
  const urlFor = (next: Partial<{ q: string; kind: KindFilter; sort: 'asc' | 'desc'; page: number }>) => {
    const q = next.q ?? query;
    const k = next.kind ?? kind;
    const s = next.sort ?? sort;
    const p = next.page ?? 1;
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (k !== 'ALL') params.set('kind', k);
    if (s !== 'asc') params.set('sort', s);
    if (p > 1) params.set('page', String(p));
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  const go = (next: Parameters<typeof urlFor>[0]) =>
    startTransition(() => router.replace(urlFor(next)));

  // Keep the box in sync if the server query changes (e.g. back/forward).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setText(query), [query]);

  // Debounce typing → URL (server refetches the matching page).
  useEffect(() => {
    if (text.trim() === query) return;
    const t = setTimeout(() => go({ q: text.trim(), page: 1 }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div className={`space-y-6 transition-opacity ${isPending ? 'opacity-60' : ''}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search schools & colleges…"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border p-0.5">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => go({ kind: t.key, page: 1 })}
                className={`rounded-md px-3 py-1 text-sm transition-colors ${
                  kind === t.key
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => go({ sort: sort === 'asc' ? 'desc' : 'asc', page: 1 })}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            title="Toggle sort order"
          >
            {sort === 'asc' ? 'A→Z' : 'Z→A'}
          </button>
        </div>
      </div>

      {institutions.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border py-16 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
            <Search className="size-6" />
          </span>
          <p className="font-semibold">No campuses found</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            No schools or colleges match your search — try a different name or clear the filters.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {institutions.map((i) => (
            <Link
              key={i.id}
              href={`/student/schools/${i.id}`}
              className="group overflow-hidden rounded-2xl border border-border bg-card shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
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
