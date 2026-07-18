import Link from 'next/link';
import Image from 'next/image';
import { notFound, redirect } from 'next/navigation';
import { Bus, CheckCircle2, Clock3, IdCard, Phone, User } from 'lucide-react';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import {
  getRouteWithStops,
  getAvailability,
  getMyActiveBookingForRoute,
  expireStaleHolds,
} from '@/features/booking/repository';
import { getStudentDetails } from '@/features/booking/services';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { BookingSteps } from '../../booking-steps';
import { ReserveForm } from './reserve-form';
import { SeatMap } from './seat-map';
import RouteStopsMap from './route-stops-map';
import BusGallery from './bus-gallery';

// 0 means the agency never set a price — treat it like "not set".
const inr = (cents: number | null) =>
  cents == null || cents === 0
    ? null
    : `₹${Math.round(cents / 100).toLocaleString('en-IN')}`;

export default async function RouteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole('STUDENT');
  const { id } = await params;
  const db = await createClient();

  // Release lapsed unpaid holds first so the seat count below is honest.
  await expireStaleHolds(db);

  const [data, details] = await Promise.all([
    getRouteWithStops(db, id),
    getStudentDetails(db),
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

  const [availability, activeBooking] = await Promise.all([
    getAvailability(db, id),
    getMyActiveBookingForRoute(db, id),
  ]);
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
        <h1 className="text-2xl font-semibold">{data.route.name}</h1>
        <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
          {soldOut ? (
            <span className="text-warning">Full — {availability.total} seats taken</span>
          ) : (
            <span className="text-success">
              {availability.available} of {availability.total} seats available
            </span>
          )}
          {fare && (
            <span>
              Fare: <span className="font-semibold text-foreground">{fare}</span>
            </span>
          )}
        </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
        {/* Left: bus/driver + route map & stops */}
        <div className="space-y-6 lg:col-span-2">
      {v && (v.bus_number || v.image_url || v.driver_name) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your bus &amp; driver</CardTitle>
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

              {/* Driver */}
              {v.driver_name && (
                <div className="flex gap-4">
                  {v.driver_photo_url ? (
                    <Image
                      src={v.driver_photo_url}
                      alt={v.driver_name}
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
                    <p className="text-base font-medium">{v.driver_name}</p>
                    {v.driver_phone && (
                      <p className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <Phone className="size-3.5" /> {v.driver_phone}
                      </p>
                    )}
                    {v.driver_license_no && (
                      <p className="text-muted-foreground">Licence: {v.driver_license_no}</p>
                    )}
                    {v.driver_experience_years != null && (
                      <p className="text-muted-foreground">{v.driver_experience_years} yrs experience</p>
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
                  payBy={
                    activeBooking.expires_at
                      ? new Intl.DateTimeFormat('en-IN', {
                          hour: 'numeric',
                          minute: '2-digit',
                          // Format in IST — without an explicit zone this renders
                          // in the SERVER's timezone (UTC on most hosts), showing
                          // Indian students a deadline 5.5 hours off for a 20-min
                          // window.
                          timeZone: 'Asia/Kolkata',
                        }).format(new Date(activeBooking.expires_at))
                      : null
                  }
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
                      You already have an active booking on this route
                      {activeBooking.status === 'WAITLISTED' ? ' (waitlisted)' : ''} — each
                      student can hold one seat per route.
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
