import Link from 'next/link';
import { notFound } from 'next/navigation';
import { InstitutionLogo } from '@/components/institution-logo';
import { VerifiedBadge } from '@/components/verified-badge';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { getInstitution, listInstitutionRoutes } from '@/features/catalog/repository';
import { expireStaleHolds } from '@/features/booking/repository';
import { BookingSteps } from '../../booking-steps';
import { RoutesExplorer } from './routes-explorer';

/**
 * Step 2 of the booking flow. One flat, comparable list of every ride serving
 * this campus (all agencies, buses AND vans) — the student picks the ride
 * directly instead of drilling through type-tab → agency → routes.
 */
export default async function SchoolDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole('STUDENT');
  const { id } = await params;

  const db = await createClient();
  // Free lapsed unpaid holds so the seat counts on the cards are honest.
  await expireStaleHolds(db);
  const [inst, routes] = await Promise.all([
    getInstitution(db, id),
    listInstitutionRoutes(db, id),
  ]);
  if (!inst) notFound();

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
      <RoutesExplorer routes={routes} />
    </section>
  );
}
