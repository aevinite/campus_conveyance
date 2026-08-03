import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Bus, CheckCircle2, Clock3, GraduationCap, Phone } from 'lucide-react';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { AppBackLink } from '@/components/ui/app-back-link';
import { getRouteWithStops, getAvailability } from '@/features/booking/repository';
import { listChildren, getChildActiveBooking } from '@/features/parent/repository';
import { getUpiSettings } from '@/lib/upi-settings';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { offeredPlans, planPrice, periodLabel, type BillingPeriod } from '@/lib/billing';
import { formatTime } from '@/lib/format-date';
import { ReserveForm } from '../../../../../student/routes/[id]/reserve-form';
import { SeatMap } from '../../../../../student/routes/[id]/seat-map';
import RouteStopsMap from '../../../../../student/routes/[id]/route-stops-map';
import { CancelBookingButton } from '../../../../../student/bookings/cancel-booking-button';

const inr = (cents: number | null) =>
  cents == null || cents === 0 ? null : `₹${Math.round(cents / 100).toLocaleString('en-IN')}`;

export default async function ParentBookRoute({
  params,
}: {
  params: Promise<{ studentId: string; routeId: string }>;
}) {
  await requireRole('PARENT');
  const { studentId, routeId } = await params;
  const db = await createClient();

  const children = await listChildren(db);
  const child = children.find((c) => c.student_id === studentId);
  if (!child) notFound(); // not linked to this parent

  const [data, availability, active, upiSettings] = await Promise.all([
    getRouteWithStops(db, routeId),
    getAvailability(db, routeId),
    getChildActiveBooking(db, studentId),
    getUpiSettings(),
  ]);
  if (!data) notFound();

  const upi = { vpa: upiSettings.vpa, payee: upiSettings.payeeName, configured: upiSettings.active && !!upiSettings.vpa };
  const childName = child.full_name ?? 'your child';
  const soldOut = availability.available <= 0;
  const notBookable = availability.total <= 0;

  const planOptions = offeredPlans(data.route).map((p) => ({
    period: p.period,
    label: p.label,
    suffix: p.suffix,
    amount: `₹${Math.round(p.cents / 100).toLocaleString('en-IN')}`,
    amountRupees: String(Math.round(p.cents / 100)),
  }));

  const activeHere = active && active.route_id === routeId ? active : null;
  const activeElsewhere = active && active.route_id !== routeId ? active : null;

  const resumePlanCents = activeHere
    ? planPrice(data.route, activeHere.billing_period as BillingPeriod | null) ?? data.route.price_cents
    : null;
  const resumeFare = inr(resumePlanCents);
  const resumeAmountRupees = resumePlanCents ? String(Math.round(resumePlanCents / 100)) : null;
  const resumePeriodLabel = activeHere ? periodLabel(activeHere.billing_period as BillingPeriod | null) : null;

  const v = data.vehicle;
  const hasGeo = data.stops.some((s) => s.lat != null && s.lng != null);

  // The reserve panel: resume/pay a held seat, report a confirmed/waitlisted
  // one, block when the child is booked elsewhere, or a fresh request.
  let panel: React.ReactNode;
  if (activeHere && activeHere.status === 'PENDING' && !activeHere.is_paid && active?.approved_at) {
    panel = (
      <ReserveForm
        routeId={routeId}
        routeName={data.route.name}
        stops={data.stops}
        soldOut={soldOut}
        destinationName={data.institutionName}
        plans={planOptions}
        upi={upi}
        bookForStudentId={studentId}
        bookingsHref="/parent"
        homeHref="/parent"
        resumeFare={resumeFare}
        resumeAmountRupees={resumeAmountRupees}
        resumePeriodLabel={resumePeriodLabel}
        resumeBookingId={activeHere.booking_id}
        resumeSubmitted={activeHere.payment_status === 'SUBMITTED'}
        payBy={activeHere.expires_at ? formatTime(activeHere.expires_at) : null}
        payByIso={activeHere.expires_at}
      />
    );
  } else if (activeHere && activeHere.status === 'PENDING' && !activeHere.is_paid) {
    panel = (
      <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm">
        <Clock3 className="mt-0.5 size-4 shrink-0 text-warning" />
        <span>{childName}&apos;s request is being approved. Once approved, you&apos;ll have 10 minutes to pay.</span>
      </div>
    );
  } else if (activeHere && activeHere.status === 'CONFIRMED') {
    panel = (
      <div className="space-y-3">
        <div className="flex items-start gap-2.5 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <span>{childName}&apos;s seat on this ride is confirmed.</span>
        </div>
        <CancelBookingButton bookingId={activeHere.booking_id} studentId={studentId} paid={activeHere.is_paid} />
      </div>
    );
  } else if (activeHere && activeHere.status === 'WAITLISTED') {
    panel = (
      <div className="space-y-3">
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning">
          <Clock3 className="mt-0.5 size-4 shrink-0" />
          <span>{childName} is on the waitlist for this ride. We&apos;ll notify you if a seat opens.</span>
        </div>
        <CancelBookingButton bookingId={activeHere.booking_id} studentId={studentId} paid={activeHere.is_paid} />
      </div>
    );
  } else if (activeElsewhere) {
    panel = (
      <div className="space-y-3">
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm">
          <Clock3 className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            {childName} already has an active booking
            {activeElsewhere.route_name ? (
              <>
                {' '}on <b>{activeElsewhere.route_name}</b>
              </>
            ) : null}{' '}
            — one bus at a time. Cancel it first to book this one.
          </span>
        </div>
        {activeElsewhere.route_id && (
          <Link
            href={`/parent/book/${studentId}/routes/${activeElsewhere.route_id}`}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary/70"
          >
            Manage that booking →
          </Link>
        )}
      </div>
    );
  } else {
    panel = (
      <ReserveForm
        routeId={routeId}
        routeName={data.route.name}
        stops={data.stops}
        soldOut={soldOut}
        notBookable={notBookable}
        destinationName={data.institutionName}
        plans={planOptions}
        upi={upi}
        bookForStudentId={studentId}
        bookingsHref="/parent"
        homeHref="/parent"
      />
    );
  }

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <AppBackLink href={`/parent/book/${studentId}`} label="Back to rides" />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <GraduationCap className="size-4 text-primary" /> Booking for <b className="text-foreground">{childName}</b>
        </div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{data.route.name}</h1>
        <p className="text-sm">
          {notBookable ? (
            <span className="font-medium text-warning">Not accepting bookings</span>
          ) : soldOut ? (
            <span className="font-medium text-warning">Full — {availability.total} seats taken</span>
          ) : (
            <span className="font-medium text-success">
              <span className="tnum">{availability.available}</span> of{' '}
              <span className="tnum">{availability.total}</span> seats available
            </span>
          )}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
        <div className="space-y-6 lg:col-span-2">
          {/* Bus & driver summary */}
          {v && (v.bus_number || v.driver_name) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Bus &amp; driver</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="space-y-1">
                  {v.bus_number && (
                    <p className="flex items-center gap-2 font-medium">
                      <Bus className="size-4 text-primary" /> Bus {v.bus_number}
                      {v.is_ac != null && (
                        <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          {v.is_ac ? 'AC' : 'Non-AC'}
                        </span>
                      )}
                    </p>
                  )}
                  {(v.bus_model || v.bus_color) && (
                    <p className="text-muted-foreground">{[v.bus_model, v.bus_color].filter(Boolean).join(' · ')}</p>
                  )}
                  {v.capacity != null && <p className="text-muted-foreground">{v.capacity} seats</p>}
                </div>
                <div className="space-y-1">
                  {(data.driverChange?.name || v.driver_name) && (
                    <>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Driver</p>
                      <p className="font-medium">{data.driverChange?.name ?? v.driver_name}</p>
                      {(data.driverChange?.phone ?? v.driver_phone) && (
                        <p className="inline-flex items-center gap-1.5 text-muted-foreground">
                          <Phone className="size-3.5" /> {data.driverChange?.phone ?? v.driver_phone}
                        </p>
                      )}
                      {data.driverChange && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                          Driver changed for today
                        </span>
                      )}
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pickup stops</CardTitle>
              <p className="text-sm text-muted-foreground">Where the bus stops to pick up.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {hasGeo && (
                <RouteStopsMap
                  stops={data.stops.map((s) => ({
                    name: s.name,
                    lat: s.lat,
                    lng: s.lng,
                    description: s.description,
                    address: s.address,
                  }))}
                />
              )}
              {data.stops.length === 0 ? (
                <p className="text-sm text-muted-foreground">No stops listed for this route yet.</p>
              ) : (
                <ol className="space-y-3 text-sm">
                  {data.stops.map((s) => (
                    <li key={s.id} className="flex gap-2.5">
                      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                        {s.sequence}
                      </span>
                      <div className="min-w-0">
                        <span className="font-medium">{s.name}</span>
                        {s.address && <span className="block text-xs text-muted-foreground/80">{s.address}</span>}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 lg:sticky lg:top-24">
          {availability.total > 0 && (
            <Card>
              <CardContent>
                <SeatMap total={availability.total} reserved={availability.reserved} />
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reserve a seat for {childName}</CardTitle>
            </CardHeader>
            <CardContent>{panel}</CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
