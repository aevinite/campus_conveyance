import { redirect } from 'next/navigation';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { isAppRequest } from '@/lib/app-context';
import { searchInstitutions, countInstitutions, type KindFilter } from '@/features/catalog/repository';
import { pageParams } from '@/components/pager';
import { BookingSteps } from '../booking-steps';
import { CatalogBrowser } from './catalog-browser';

const PAGE_SIZE = 12;

export default async function SchoolsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string; sort?: string; page?: string }>;
}) {
  await requireRole('STUDENT');
  const sp = await searchParams;
  const query = (sp.q ?? '').trim();
  const kind: KindFilter = sp.kind === 'SCHOOL' || sp.kind === 'COLLEGE' ? sp.kind : 'ALL';
  const sort: 'asc' | 'desc' = sp.sort === 'desc' ? 'desc' : 'asc';
  const { page, offset } = pageParams(sp.page, PAGE_SIZE);

  const db = await createClient();
  // Filtered + sorted + paginated in the DB — the browser only ever gets one
  // page of campuses, not the whole (unbounded) catalog.
  const [institutions, total, app] = await Promise.all([
    searchInstitutions(db, { query, kind, sort, limit: PAGE_SIZE, offset }),
    countInstitutions(db, { query, kind }),
    isAppRequest(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total > 0 && page > totalPages) {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (kind !== 'ALL') params.set('kind', kind);
    if (sort !== 'asc') params.set('sort', sort);
    if (totalPages > 1) params.set('page', String(totalPages));
    const qs = params.toString();
    redirect(qs ? `/student/schools?${qs}` : '/student/schools');
  }

  return (
    <section className="space-y-6">
      <div className={app ? 'space-y-3' : 'space-y-4'}>
        <BookingSteps active={1} compact={app} />
        {app ? (
          <h1 className="text-2xl font-bold tracking-tight">Pick your campus</h1>
        ) : (
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              Step 1 · Campus
            </p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Pick your campus</h1>
            <p className="mt-1 text-muted-foreground">
              Choose your school or college — you&apos;ll see every bus and van that
              runs there for the daily commute.
            </p>
          </div>
        )}
      </div>
      <CatalogBrowser
        institutions={institutions}
        query={query}
        kind={kind}
        sort={sort}
        page={page}
        totalPages={totalPages}
        app={app}
      />
    </section>
  );
}
