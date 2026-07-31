import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Ticket, ArrowLeft } from 'lucide-react';
import { InstitutionLogo } from '@/components/institution-logo';
import { VerifiedBadge } from '@/components/verified-badge';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { isAppRequest } from '@/lib/app-context';
import {
  getInstitution,
  listInstitutionAgencies,
  type VehicleType,
} from '@/features/catalog/repository';
import { getMyActiveBooking } from '@/features/booking/repository';
import { BookingSteps } from '../../booking-steps';
import { AgencyList, VehicleTabs } from './agency-list';

/**
 * Step 2 of the booking flow. Shows a brief description of the campus, a Bus/Van
 * chooser, and the agencies running the chosen vehicle type to the campus; the
 * student picks one, then sees just that agency's rides (step 3). Replaces the
 * old flat "every ride at once" list.
 */
export default async function SchoolDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  await requireRole('STUDENT');
  const { id } = await params;
  const sp = await searchParams;
  // Default to Bus; Van is the other tab.
  const vehicleType: VehicleType = sp.type === 'VAN' ? 'VAN' : 'BUS';

  const db = await createClient();
  const [inst, agencies, currentBooking, app] = await Promise.all([
    getInstitution(db, id),
    listInstitutionAgencies(db, id, vehicleType),
    getMyActiveBooking(db),
    isAppRequest(),
  ]);
  if (!inst) notFound();

  return (
    <section className="space-y-6">
      {app ? (
        <div className="space-y-3">
          <Link href="/student/schools" className="inline-flex items-center gap-1 text-sm text-muted-foreground">
            <ArrowLeft className="size-4" /> Campuses
          </Link>
          {/* Compact campus header — logo tile + name inline, no gradient hero. */}
          <div className="flex items-center gap-3">
            <InstitutionLogo
              name={inst.name}
              kind={inst.kind}
              imageUrl={inst.image_url}
              className="size-14 shrink-0"
              iconClassName="size-6"
            />
            <div className="min-w-0">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {inst.kind === 'COLLEGE' ? 'College' : 'School'}
              </span>
              <h1 className="flex items-center gap-1.5 text-xl font-bold tracking-tight">
                <span className="truncate">{inst.name}</span>
                <VerifiedBadge verified={inst.is_verified} />
              </h1>
            </div>
          </div>
          {inst.description && (
            <p className="text-sm leading-relaxed text-muted-foreground">{inst.description}</p>
          )}
        </div>
      ) : (
        <>
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
                <h1 className="mt-4 flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
                  {inst.name}
                  <VerifiedBadge verified={inst.is_verified} className="text-[1.25rem]" />
                </h1>
                {inst.description && (
                  <p className="mt-1.5 max-w-2xl leading-relaxed text-muted-foreground">
                    {inst.description}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-widest text-primary">
                Step 2 · Choose an agency
              </p>
              <h2 className="text-xl font-bold tracking-tight">
                {vehicleType === 'VAN' ? 'Van operators' : 'Bus agencies'}
              </h2>
              <p className="text-sm text-muted-foreground">
                Pick a vehicle type, then choose who runs your {vehicleType === 'VAN' ? 'van' : 'bus'} to{' '}
                {inst.name} — tap one to see its routes, fares and live seats.
              </p>
            </div>
            <VehicleTabs institutionId={id} active={vehicleType} />
          </div>
        </>
      )}

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

      {app && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-primary">Choose an agency</p>
          <VehicleTabs institutionId={id} active={vehicleType} />
        </div>
      )}
      <AgencyList agencies={agencies} institutionId={id} vehicleType={vehicleType} />
    </section>
  );
}
