import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Ticket } from 'lucide-react';
import { InstitutionLogo } from '@/components/institution-logo';
import { VerifiedBadge } from '@/components/verified-badge';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import {
  getInstitution,
  listInstitutionRoutes,
  countInstitutionRoutes,
  type VehicleType,
} from '@/features/catalog/repository';
import { getMyActiveBooking } from '@/features/booking/repository';
import { pageParams } from '@/components/pager';
import { BookingSteps } from '../../booking-steps';
import { RoutesExplorer } from './routes-explorer';

const PAGE_SIZE = 15;

/**
 * Step 2 of the booking flow. One flat, comparable list of every ride serving
 * this campus (all agencies, buses AND vans) — the student picks the ride
 * directly instead of drilling through type-tab → agency → routes.
 */
export default async function SchoolDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; type?: string; page?: string }>;
}) {
  await requireRole('STUDENT');
  const { id } = await params;
  const sp = await searchParams;
  const query = (sp.q ?? '').trim();
  const vehicleType: VehicleType | undefined =
    sp.type === 'BUS' || sp.type === 'VAN' ? sp.type : undefined;
  const { page, offset } = pageParams(sp.page, PAGE_SIZE);

  const db = await createClient();
  // Lapsed holds are swept by the pg_cron 'expire-stale-holds' job (migration
  // 0052); seat counts here tolerate <=60s of staleness. Routes are searched +
  // paginated in the DB (migration 0068) — one page, not every campus route.
  const [inst, routes, total, currentBooking] = await Promise.all([
    getInstitution(db, id),
    listInstitutionRoutes(db, id, { query, vehicleType, limit: PAGE_SIZE, offset }),
    countInstitutionRoutes(db, id, { query, vehicleType }),
    getMyActiveBooking(db),
  ]);
  if (!inst) notFound();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total > 0 && page > totalPages) {
    const p = new URLSearchParams();
    if (query) p.set('q', query);
    if (vehicleType) p.set('type', vehicleType);
    if (totalPages > 1) p.set('page', String(totalPages));
    const qs = p.toString();
    redirect(qs ? `/student/schools/${id}?${qs}` : `/student/schools/${id}`);
  }

  return (
    <section className="space-y-6">
      <div className="space-y-4">
        <Link href="/student/schools" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
          ← All campuses
        </Link>
        <BookingSteps active={2} />
        <div className="overflow-hidden rounded-3xl border border-border bg-card">
          <div
            className="relative h-24 sm:h-28"
            style={{
              background:
                'linear-gradient(135deg, color-mix(in oklch, var(--primary) 30%, transparent), color-mix(in oklch, var(--chart-5) 28%, transparent))',
            }}
          >
            <div aria-hidden className="absolute inset-0 opacity-60 bg-grid" />
          </div>
          <div className="px-6 pb-6">
            <div className="-mt-12 flex items-end gap-4">
              <InstitutionLogo
                name={inst.name}
                kind={inst.kind}
                imageUrl={inst.image_url}
                className="size-24 ring-2 ring-background"
                iconClassName="size-10"
              />
              <span className="mb-1 inline-flex items-center rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {inst.kind === 'COLLEGE' ? 'College' : 'School'}
              </span>
            </div>
            <h1 className="mt-4 flex items-center gap-2 text-2xl font-semibold">
              {inst.name}
              <VerifiedBadge verified={inst.is_verified} className="text-[1.25rem]" />
            </h1>
            <p className="mt-1.5 max-w-2xl leading-relaxed text-muted-foreground">
              {inst.description}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Pick your bus</h2>
        <p className="text-sm text-muted-foreground">
          Every ride to {inst.name} — compare fares, timings and live seats, then
          tap one to reserve.
        </p>
      </div>
      {/* One bus at a time: browsing stays open, booking is locked. */}
      {currentBooking && (
        <div className="flex items-start gap-2.5 rounded-xl border border-primary/30 bg-primary/[0.06] px-4 py-3 text-sm">
          <Ticket className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>
            You have an active booking
            {currentBooking.routeName ? (
              <>
                {' '}on <b>{currentBooking.routeName}</b>
              </>
            ) : null}
            {' '}— you can browse freely, but booking another bus opens only after
            it ends or is cancelled.{' '}
            <Link href="/student/bookings" className="font-medium text-primary hover:text-primary/70">
              Manage it →
            </Link>
          </span>
        </div>
      )}
      <RoutesExplorer
        routes={routes}
        query={query}
        vehicleType={vehicleType ?? 'ALL'}
        page={page}
        totalPages={totalPages}
      />
    </section>
  );
}
