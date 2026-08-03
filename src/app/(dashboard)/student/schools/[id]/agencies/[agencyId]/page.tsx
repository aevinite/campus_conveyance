import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Ticket, ArrowLeft, Building2 } from 'lucide-react';
import { StarRating } from '@/components/ui/star-rating';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { isAppRequest } from '@/lib/app-context';
import {
  getInstitution,
  listInstitutionAgencies,
  listInstitutionRoutes,
  countInstitutionRoutes,
  type VehicleType,
} from '@/features/catalog/repository';
import { getMyActiveBooking } from '@/features/booking/repository';
import { pageParams } from '@/components/pager';
import { BookingSteps } from '../../../../booking-steps';
import { RoutesExplorer } from '../../routes-explorer';

const PAGE_SIZE = 15;

/** Two initials from an agency name for the header chip. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Step 3 of the booking flow: one agency's buses at a campus. The student got
 * here by picking an agency on the campus page; here they pick the actual ride.
 * `agencyId` is a real agency uuid, or the sentinel 'campus' for agency-less
 * (seeded) routes.
 */
export default async function AgencyRoutesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; agencyId: string }>;
  searchParams: Promise<{ q?: string; type?: string; page?: string }>;
}) {
  await requireRole('STUDENT');
  const { id, agencyId } = await params;
  const sp = await searchParams;
  const query = (sp.q ?? '').trim();
  const vehicleType: VehicleType | undefined =
    sp.type === 'BUS' || sp.type === 'VAN' ? sp.type : undefined;
  const { page, offset } = pageParams(sp.page, PAGE_SIZE);

  const db = await createClient();
  const [inst, agencies, app] = await Promise.all([
    getInstitution(db, id),
    listInstitutionAgencies(db, id),
    isAppRequest(),
  ]);
  if (!inst) notFound();

  // Validate the agency actually serves this campus (also gives us its name /
  // rating); an unknown or suspended agency drops back to the campus page.
  const agency = agencies.find((a) => a.id === agencyId);
  if (!agency) redirect(`/student/schools/${id}`);

  const isCampus = agencyId === 'campus';
  const routeFilter = {
    query,
    vehicleType,
    agencyId: isCampus ? undefined : agencyId,
    orphanOnly: isCampus,
  };

  const [routes, total, currentBooking] = await Promise.all([
    listInstitutionRoutes(db, id, { ...routeFilter, limit: PAGE_SIZE, offset }),
    countInstitutionRoutes(db, id, routeFilter),
    getMyActiveBooking(db),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total > 0 && page > totalPages) {
    const p = new URLSearchParams();
    if (query) p.set('q', query);
    if (vehicleType) p.set('type', vehicleType);
    if (totalPages > 1) p.set('page', String(totalPages));
    const qs = p.toString();
    const base = `/student/schools/${id}/agencies/${agencyId}`;
    redirect(qs ? `${base}?${qs}` : base);
  }

  const backHref = vehicleType ? `/student/schools/${id}?type=${vehicleType}` : `/student/schools/${id}`;

  return (
    <section className="space-y-6">
      {app ? (
        <div className="space-y-3">
          <Link
            href={backHref}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors active:bg-muted"
          >
            <ArrowLeft className="size-4 text-primary" /> Agencies
          </Link>
          <div className="flex items-center gap-3">
            <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-base font-bold text-primary ring-1 ring-inset ring-primary/15">
              {isCampus ? <Building2 className="size-6" /> : initials(agency.name)}
            </span>
            <div className="min-w-0">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Buses to {inst.name}
              </span>
              <h1 className="truncate text-xl font-bold tracking-tight">{agency.name}</h1>
              {!isCampus && agency.ratingCount > 0 && (
                <StarRating value={agency.ratingAvg} count={agency.ratingCount} size={13} />
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            <Link href={backHref} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              ← Agencies at {inst.name}
            </Link>
            <BookingSteps active={3} />
            <div className="flex items-center gap-4 rounded-3xl border border-border bg-card p-5 sm:p-6">
              <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-xl font-bold tracking-tight text-primary ring-1 ring-inset ring-primary/15 sm:size-20">
                {isCampus ? <Building2 className="size-8" /> : initials(agency.name)}
              </span>
              <div className="min-w-0">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Buses to {inst.name}
                </span>
                <h1 className="mt-0.5 text-2xl font-bold tracking-tight sm:text-3xl">{agency.name}</h1>
                {isCampus ? (
                  <p className="mt-1 text-sm text-muted-foreground">Direct campus rides</p>
                ) : agency.ratingCount > 0 ? (
                  <StarRating value={agency.ratingAvg} count={agency.ratingCount} size={15} className="mt-1" />
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">New agency</p>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              Step 3 · Choose a ride
            </p>
            <h2 className="text-xl font-bold tracking-tight">Pick your bus</h2>
            <p className="text-sm text-muted-foreground">
              Compare fares, timings and live seats, then tap one to reserve.
            </p>
          </div>
        </>
      )}

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
