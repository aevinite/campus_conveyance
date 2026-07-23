import Link from 'next/link';
import Image from 'next/image';
import { notFound, redirect } from 'next/navigation';
import { Bus, CheckCircle2, Clock3, IdCard, Phone, ShieldCheck, User } from 'lucide-react';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import {
  getRouteWithStops,
  getAvailability,
  getMyActiveBooking,
} from '@/features/booking/repository';
import { getStudentDetails } from '@/features/booking/services';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { BookingSteps } from '../../booking-steps';
import { ReserveForm } from './reserve-form';
import { SeatMap } from './seat-map';
import RouteStopsMap from './route-stops-map';
import BusGallery from './bus-gallery';
import { formatTime } from '@/lib/format-date';

// 0 means the agency never set a price — treat it like "not set".
const inr = (cents: number | null) =>
  cents == null || cents === 0
    ? null
    : `₹${Math.round(cents / 100).toLocaleString('en-IN')}`;

// Show only the last 4 digits of a government/ID card number to riders — enough
// to recognise it's on file without exposing the full sensitive number.
function maskId(id: string): string {
  const digits = id.replace(/\s+/g, '');
  if (digits.length <= 4) return digits;
  return `•••• ${digits.slice(-4)}`;
}

export default async function RouteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole('STUDENT');
  const { id } = await params;
  const db = await createClient();

  // Lapsed holds are swept by pg_cron (migration 0052); reserve_seat also expires
  // them inline, so the seat count here is honest at reservation time.

  // One batch: route+stops, the student's details, seat availability, and their
  // single active booking (one bus at a time — on this route it resumes/reports,
  // on another it locks booking here). All key only off id/the caller, so fetch
  // together rather than in two sequential batches.
  const [data, details, availability, currentBooking] = await Promise.all([
    getRouteWithStops(db, id),
    getStudentDetails(db),
    getAvailability(db, id),
    getMyActiveBooking(db),
  ]);
  if (!data) notFound();

  // Details-first flow: reserving without name/phone/address would hand the
  // agency an empty student record, so send the student to the details form
  // and bring them back here afterwards.
  const detailsComplete =
    details.fullName.trim() && details.phone.trim() && details.address.trim();
  if (!detailsComplete) {
    redirect(`/student/details?next=${encodeURIComponent(`/student/routes/${id}`)}`);
  }
  const activeBooking = currentBooking?.routeId === id ? currentBooking : null;
  const otherBooking = currentBooking && currentBooking.routeId !== id ? currentBooking : null;
  const soldOut = availability.available <= 0;
  // A zero-capacity route isn't sold out — it's not bookable at all (a waitlist
  // entry here could never be promoted). Kept distinct from soldOut so the panel
  // shows "not accepting bookings" instead of a dead "Join waitlist" button.
  const notBookable = availability.total <= 0;
  const fare = inr(data.route.price_cents);
  const v = data.vehicle;
  const busPhotos = v ? (v.photos?.length ? v.photos : v.image_url ? [v.image_url] : []) : [];
  const hasGeo = data.stops.some((s) => s.lat != null && s.lng != null);

  return (
    <section className="space-y-6">
      <div className="space-y-4">
        <Link href="/student/schools" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
          ← Back to campuses
        </Link>
        <BookingSteps active={3} />
        <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          Step 3 · Reserve &amp; pay
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{data.route.name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {notBookable ? (
            <span className="font-medium text-warning">Not accepting bookings</span>
          ) : soldOut ? (
            <span className="font-medium text-warning">Full — <span className="tnum">{availability.total}</span> seats taken</span>
          ) : (
            <span className="font-medium text-success">
              <span className="tnum">{availability.available}</span> of{' '}
              <span className="tnum">{availability.total}</span> seats available
            </span>
          )}
          {fare && (
            <span>
              Fare: <span className="tnum font-semibold text-foreground">{fare}</span>
            </span>
          )}
        </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
        {/* Left: bus/driver + route map & stops */}
        <div className="space-y-6 lg:col-span-2">
      {v && (v.bus_number || v.image_url || v.driver_name || v.conductor_name || data.conductorChange) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your bus, driver &amp; conductor</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Bus photo gallery */}
            {busPhotos.length > 0 ? (
              <BusGallery photos={busPhotos} alt={v.bus_number ? `Bus ${v.bus_number}` : 'Bus'} />
            ) : (
              <div className="grid h-40 w-full place-items-center rounded-xl border border-border bg-muted/40 text-muted-foreground">
                <Bus className="size-10" />
              </div>
            )}

            <div className="grid gap-5 sm:grid-cols-2">
              {/* Bus details */}
              <div className="space-y-1 text-sm">
                <p className="flex items-center gap-2">
                  {v.bus_number && (
                    <span className="text-base font-semibold">Bus {v.bus_number}</span>
                  )}
                  {v.is_ac != null && (
                    <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {v.is_ac ? 'AC' : 'Non-AC'}
                    </span>
                  )}
                </p>
                {(v.bus_model || v.bus_color) && (
                  <p className="text-muted-foreground">
                    {[v.bus_model, v.bus_color].filter(Boolean).join(' · ')}
                  </p>
                )}
                {v.capacity != null && <p className="text-muted-foreground">{v.capacity} seats</p>}
                {v.registration_no && (
                  <p className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <IdCard className="size-3.5" /> {v.registration_no}
                  </p>
                )}
              </div>

              {/* Driver — shows today's substitute if the agency changed it. */}
              {(v.driver_name || data.driverChange) && (
                <div className="flex gap-4">
                  {!data.driverChange && v.driver_photo_url ? (
                    <Image
                      src={v.driver_photo_url}
                      alt={v.driver_name ?? 'Driver'}
                      width={192}
                      height={192}
                      unoptimized
                      className="size-24 shrink-0 rounded-full border border-border object-cover sm:size-28"
                    />
                  ) : (
                    <span className="grid size-24 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground sm:size-28">
                      <User className="size-10" />
                    </span>
                  )}
                  <div className="space-y-1 text-sm">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Driver</p>
                    {data.driverChange ? (
                      <>
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                          <Clock3 className="size-3.5" /> Driver changed for today
                        </span>
                        <p className="text-base font-medium">{data.driverChange.name}</p>
                        {data.driverChange.phone && (
                          <p className="inline-flex items-center gap-1.5 text-muted-foreground">
                            <Phone className="size-3.5" /> {data.driverChange.phone}
                          </p>
                        )}
                        {data.driverChange.govtId && (
                          <p className="text-muted-foreground">ID card: {maskId(data.driverChange.govtId)}</p>
                        )}
                        {data.driverChange.bloodGroup && (
                          <p className="text-muted-foreground">Blood group: {data.driverChange.bloodGroup}</p>
                        )}
                        {data.driverChange.altPhone && (
                          <p className="text-muted-foreground">Emergency contact: {data.driverChange.altPhone}</p>
                        )}
                        {data.driverChange.reason && (
                          <p className="text-muted-foreground">{data.driverChange.reason}</p>
                        )}
                        {v.driver_name && (
                          <p className="text-xs text-muted-foreground/80">Regular driver: {v.driver_name}</p>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-base font-medium">{v.driver_name}</p>
                          {v.driver_verified && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                              <ShieldCheck className="size-3" /> Verified driver
                            </span>
                          )}
                        </div>
                        {v.driver_phone && (
                          <p className="inline-flex items-center gap-1.5 text-muted-foreground">
                            <Phone className="size-3.5" /> {v.driver_phone}
                          </p>
                        )}
                        {v.driver_license_no && (
                          <p className="text-muted-foreground">Licence: {v.driver_license_no}</p>
                        )}
                        {v.driver_govt_id && (
                          <p className="text-muted-foreground">ID card: {maskId(v.driver_govt_id)}</p>
                        )}
                        {v.driver_blood_group && (
                          <p className="text-muted-foreground">Blood group: {v.driver_blood_group}</p>
                        )}
                        {v.driver_experience_years != null && (
                          <p className="text-muted-foreground">{v.driver_experience_years} yrs experience</p>
                        )}
                        {v.driver_alt_phone && (
                          <p className="text-muted-foreground">Emergency contact: {v.driver_alt_phone}</p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Conductor — shows today's substitute if the agency changed it. */}
              {(v.conductor_name || data.conductorChange) && (
                <div className="flex gap-4">
                  <span className="grid size-24 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground sm:size-28">
                    <User className="size-10" />
                  </span>
                  <div className="space-y-1 text-sm">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Conductor</p>
                    {data.conductorChange ? (
                      <>
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                          <Clock3 className="size-3" /> Conductor changed for today
                        </span>
                        <p className="text-base font-medium">{data.conductorChange.name}</p>
                        {data.conductorChange.phone && (
                          <p className="inline-flex items-center gap-1.5 text-muted-foreground">
                            <Phone className="size-3.5" /> {data.conductorChange.phone}
                          </p>
                        )}
                        {data.conductorChange.govtId && (
                          <p className="text-muted-foreground">ID card: {maskId(data.conductorChange.govtId)}</p>
                        )}
                        {data.conductorChange.bloodGroup && (
                          <p className="text-muted-foreground">Blood group: {data.conductorChange.bloodGroup}</p>
                        )}
                        {data.conductorChange.altPhone && (
                          <p className="text-muted-foreground">Emergency contact: {data.conductorChange.altPhone}</p>
                        )}
                        {data.conductorChange.reason && (
                          <p className="text-muted-foreground">{data.conductorChange.reason}</p>
                        )}
                        {v.conductor_name && (
                          <p className="text-xs text-muted-foreground/80">Regular conductor: {v.conductor_name}</p>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-base font-medium">{v.conductor_name}</p>
                          {v.conductor_verified && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                              <ShieldCheck className="size-3" /> Verified
                            </span>
                          )}
                        </div>
                        {v.conductor_phone && (
                          <p className="inline-flex items-center gap-1.5 text-muted-foreground">
                            <Phone className="size-3.5" /> {v.conductor_phone}
                          </p>
                        )}
                        {v.conductor_govt_id && (
                          <p className="text-muted-foreground">ID card: {maskId(v.conductor_govt_id)}</p>
                        )}
                        {v.conductor_blood_group && (
                          <p className="text-muted-foreground">Blood group: {v.conductor_blood_group}</p>
                        )}
                        {v.conductor_alt_phone && (
                          <p className="text-muted-foreground">Emergency contact: {v.conductor_alt_phone}</p>
                        )}
                      </>
                    )}
                  </div>
                </div>
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
              // Live tracking only for a student who actually has a seat on this
              // route (PENDING hold or CONFIRMED) — a WAITLISTED rider has no seat
              // and isn't on the bus, so they don't get the live map.
              liveRouteId={activeBooking && activeBooking.status !== 'WAITLISTED' ? id : undefined}
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
                    {s.description && (
                      <span className="block text-muted-foreground">{s.description}</span>
                    )}
                    {s.address && (
                      <span className="block text-xs text-muted-foreground/80">{s.address}</span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
        </div>

        {/* Right: reserve panel (sticky on desktop) */}
        <div className="space-y-6 lg:sticky lg:top-24">
          {/* View-only seat layout: how full is this bus right now. */}
          {availability.total > 0 && (
            <Card>
              <CardContent>
                <SeatMap total={availability.total} reserved={availability.reserved} />
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reserve a seat</CardTitle>
            </CardHeader>
            <CardContent>
              {activeBooking &&
              activeBooking.status === 'PENDING' &&
              !activeBooking.is_paid &&
              activeBooking.approved_at ? (
                // Agency approved — the payment window is open, let the
                // student pay right here.
                <ReserveForm
                  routeId={id}
                  routeName={data.route.name}
                  stops={data.stops}
                  soldOut={soldOut}
                  destinationName={data.institutionName}
                  fare={fare}
                  resumeBookingId={activeBooking.id}
                  // Pickup was chosen at request time; resolve its name from the
                  // route's stops so the resume-payment receipt can show it.
                  resumePickupName={
                    data.stops.find((s) => s.id === activeBooking.pickup_stop_id)?.name ?? null
                  }
                  payBy={activeBooking.expires_at ? formatTime(activeBooking.expires_at) : null}
                  payByIso={activeBooking.expires_at}
                />
              ) : activeBooking &&
                activeBooking.status === 'PENDING' &&
                !activeBooking.is_paid ? (
                // Request placed but not yet approved (rare — e.g. a waitlist
                // spot that hasn't been auto-promoted yet).
                <div className="space-y-3">
                  <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm">
                    <Clock3 className="mt-0.5 size-4 shrink-0 text-warning" />
                    <span>
                      Your request for this route is <b>being approved</b>. Once approved,
                      you&apos;ll have 20 minutes to complete the payment.
                    </span>
                  </div>
                  <Link
                    href="/student/bookings"
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary/70"
                  >
                    Track it in My bookings →
                  </Link>
                </div>
              ) : activeBooking ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-2.5 rounded-lg border border-primary/30 bg-primary/[0.06] px-3 py-2.5 text-sm">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>
                      This is your active booking
                      {activeBooking.status === 'WAITLISTED' ? ' (waitlisted)' : ''} — you can
                      book one bus at a time.
                    </span>
                  </div>
                  <Link
                    href="/student/bookings"
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary/70"
                  >
                    Manage it in My bookings →
                  </Link>
                </div>
              ) : otherBooking ? (
                // The one-bus-at-a-time rule: an active booking on ANOTHER
                // route locks booking here (browsing is always allowed).
                <div className="space-y-3">
                  <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm">
                    <Clock3 className="mt-0.5 size-4 shrink-0 text-warning" />
                    <span>
                      You already have an active booking
                      {otherBooking.routeName ? (
                        <>
                          {' '}on <b>{otherBooking.routeName}</b>
                        </>
                      ) : null}
                      {' '}— you can book only one bus at a time. Cancel it or wait
                      until it ends to book this one.
                    </span>
                  </div>
                  <Link
                    href="/student/bookings"
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary/70"
                  >
                    Manage it in My bookings →
                  </Link>
                </div>
              ) : (
                <ReserveForm
                  routeId={id}
                  routeName={data.route.name}
                  stops={data.stops}
                  soldOut={soldOut}
                  notBookable={notBookable}
                  destinationName={data.institutionName}
                  fare={fare}
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
