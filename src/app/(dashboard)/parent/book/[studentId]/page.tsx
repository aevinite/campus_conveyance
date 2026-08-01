import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GraduationCap, Ticket, Clock3, ArrowLeft } from 'lucide-react';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { listChildren, getChildActiveBooking } from '@/features/parent/repository';
import { listInstitutionAgencies, type VehicleType } from '@/features/catalog/repository';
import { AgencyList, VehicleTabs } from '../../../student/schools/[id]/agency-list';

export default async function ParentBookPickAgency({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  await requireRole('PARENT');
  const { studentId } = await params;
  const sp = await searchParams;
  const vehicleType: VehicleType = sp.type === 'VAN' ? 'VAN' : 'BUS';
  const db = await createClient();

  const children = await listChildren(db);
  const child = children.find((c) => c.student_id === studentId);
  if (!child) notFound(); // not linked to this parent

  const [active, agencies] = await Promise.all([
    getChildActiveBooking(db, studentId),
    child.institution_id
      ? listInstitutionAgencies(db, child.institution_id, vehicleType)
      : Promise.resolve([]),
  ]);

  const childName = child.full_name ?? 'your child';
  const basePath = `/parent/book/${studentId}`;

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <Link href={`/parent/child/${studentId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to {childName}
        </Link>
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary">
            <GraduationCap className="size-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Book a bus for {childName}</h1>
            <p className="text-sm text-muted-foreground">
              {child.institution_name ?? 'Their campus'} · choose an agency, then its route
            </p>
          </div>
        </div>
      </div>

      {/* Active booking banner — continue it rather than starting a second one. */}
      {active && (
        <div className="flex flex-col gap-3 rounded-2xl border border-primary/30 bg-primary/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5 text-sm">
            <Clock3 className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>
              {childName} already has an active booking
              {active.route_name ? (
                <>
                  {' '}on <b>{active.route_name}</b>
                </>
              ) : null}{' '}
              ({active.status.toLowerCase()}). One bus at a time — continue it below.
            </span>
          </div>
          {active.route_id && (
            <Link
              href={`${basePath}/routes/${active.route_id}`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Ticket className="size-4" /> Continue booking
            </Link>
          )}
        </div>
      )}

      {!child.institution_id ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          This child has no campus set yet, so there are no agencies to show.
        </p>
      ) : (
        <>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">
              {vehicleType === 'VAN' ? 'Van operators' : 'Bus agencies'} for {child.institution_name ?? 'this campus'}
            </h2>
            <p className="text-sm text-muted-foreground">
              Pick a vehicle type, then choose who runs your {vehicleType === 'VAN' ? 'van' : 'bus'} — tap
              one to see its routes, fares and live seats.
            </p>
          </div>
          <VehicleTabs basePath={basePath} active={vehicleType} />
          <AgencyList agencies={agencies} basePath={basePath} vehicleType={vehicleType} />
        </>
      )}
    </section>
  );
}
