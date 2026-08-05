import Link from 'next/link';
import { Search, Ticket, ArrowRight, Sparkles, MapPin } from 'lucide-react';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { isAppRequest } from '@/lib/app-context';
import { getSessionClaims } from '@/features/auth/session';
import {
  listRecentBookings,
  myBookingStatusCounts,
  getMyActiveBooking,
} from '@/features/booking/repository';
import { listFeaturedInstitutions } from '@/features/catalog/repository';
import { InstitutionLogo } from '@/components/institution-logo';
import { VerifiedBadge } from '@/components/verified-badge';
import { AppStudentHome } from '@/components/app-student-home';
import { BusPassCard } from '@/components/bus-pass-card';
import { PreBookingInfo } from '@/components/pre-booking-info';
import { getPublicStatsSafe } from '@/lib/public-stats';
import RouteStopsMap, { type MapStop } from './routes/[id]/route-stops-map';
import { formatShortDate, formatWeekdayDate } from '@/lib/format-date';

// Bookings whose bus is worth showing a live map for.
const TRACKABLE = new Set(['CONFIRMED', 'PENDING']);

const STATUS_META: Record<
  string,
  { label: string; dot: string; pill: string; bar: string }
> = {
  CONFIRMED: { label: 'Confirmed', dot: 'bg-success', pill: 'border-success/30 bg-success/10 text-success', bar: 'bg-success' },
  WAITLISTED: { label: 'Waitlisted', dot: 'bg-warning', pill: 'border-warning/30 bg-warning/10 text-warning', bar: 'bg-warning' },
  PENDING: { label: 'Pending', dot: 'bg-primary', pill: 'border-primary/30 bg-primary/10 text-primary', bar: 'bg-primary' },
  CANCELLED: { label: 'Cancelled', dot: 'bg-muted-foreground', pill: 'border-border bg-muted text-muted-foreground', bar: 'bg-muted-foreground' },
  REJECTED: { label: 'Rejected', dot: 'bg-destructive', pill: 'border-destructive/30 bg-destructive/10 text-destructive', bar: 'bg-destructive' },
};

export default async function StudentHome() {
  await requireRole('STUDENT');
  const db = await createClient();
  const app = await isAppRequest();
  const [{ fullName }, recentRows, statusCounts, featured, activeBooking, stats] = await Promise.all([
    getSessionClaims(db),
    listRecentBookings(db, 8),
    myBookingStatusCounts(db),
    listFeaturedInstitutions(db, 12),
    getMyActiveBooking(db),
    getPublicStatsSafe(),
  ]);
  const name = (fullName ?? 'there').split(' ')[0];
  const preBooking = !activeBooking;
  const recent = recentRows.slice(0, 4);

  // The active booking powers the bus-pass card + the live map. Fetch its stops
  // (for the map + the rider's pickup name) and the bus number once, only when
  // there's an active booking.
  const trackRouteId =
    activeBooking && activeBooking.routeId && TRACKABLE.has(activeBooking.status)
      ? activeBooking.routeId
      : null;
  let trackStops: MapStop[] = [];
  let pickupName: string | null = null;
  let busNumber: string | null = null;
  if (activeBooking?.routeId) {
    const [{ data: stopRows }, { data: routeRow }] = await Promise.all([
      db
        .from('route_stops')
        .select('id, name, lat, lng, description, address, sequence')
        .eq('route_id', activeBooking.routeId)
        .order('sequence'),
      db.from('routes').select('vehicles(bus_number)').eq('id', activeBooking.routeId).maybeSingle(),
    ]);
    trackStops = (stopRows ?? []).map((s) => ({
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      description: s.description,
      address: s.address,
    }));
    pickupName =
      (stopRows ?? []).find((s) => s.id === activeBooking.pickup_stop_id)?.name ?? null;
    const vv = (routeRow as { vehicles: { bus_number: string | null } | { bus_number: string | null }[] | null } | null)?.vehicles;
    busNumber = (Array.isArray(vv) ? vv[0] : vv)?.bus_number ?? null;
  }
  const passStart = activeBooking ? activeBooking.paid_at ?? activeBooking.created_at : null;
  const passRenewHref = activeBooking?.routeId ? `/student/routes/${activeBooking.routeId}` : '/student/schools';

  // Status breakdown for the mini bar chart (only non-empty buckets). Cancelled
  // bookings are hidden from the student panel entirely.
  const breakdown = (['CONFIRMED', 'PENDING', 'WAITLISTED', 'REJECTED'] as const)
    .map((s) => ({ status: s, count: statusCounts[s] ?? 0 }))
    .filter((x) => x.count > 0);
  const totalBookings = breakdown.reduce((a, b) => a + b.count, 0);

  // Native app gets a compact, action-first home hub; the website keeps the
  // full dashboard below.
  if (app) {
    return (
      <AppStudentHome
        name={name}
        dateLabel={formatWeekdayDate(new Date())}
        active={
          activeBooking
            ? {
                routeName: activeBooking.routeName,
                status: activeBooking.status,
                isPaid: activeBooking.is_paid,
                paymentStatus: activeBooking.payment_status,
                billingPeriod: activeBooking.billing_period,
                startIso: passStart,
                pickupName,
                busNumber,
                route_id: activeBooking.routeId,
              }
            : null
        }
        campuses={featured.map((i) => ({
          id: i.id,
          name: i.name,
          kind: i.kind,
          image_url: i.image_url,
          is_verified: i.is_verified,
        }))}
        trackRouteId={trackRouteId}
        trackStops={trackStops}
        stats={stats}
        helpHref="/student/help"
      />
    );
  }

  return (
    <div className="space-y-8">
      {/* Greeting hero */}
      <section className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            <span aria-hidden className="h-px w-8 bg-gradient-to-r from-transparent to-primary" />
            <Sparkles className="size-3.5" />
            <span className="tnum">{formatWeekdayDate(new Date())}</span>
          </div>
          <h1 className="mt-4 max-w-2xl text-3xl font-bold tracking-tight sm:text-5xl">
            Welcome back, <span className="text-gradient">{name}</span>.
          </h1>
          <p className="mt-3 max-w-xl text-muted-foreground">
            {activeBooking
              ? 'Here’s your pass, your live bus, and everything about your daily ride.'
              : 'Browse your campus, pick a bus from a verified agency, and reserve your seat for the daily route.'}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
          <Link
            href="/student/schools"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
          >
            <Search className="size-4" />
            Browse campuses
          </Link>
          <Link
            href="/student/bookings"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background/60 px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-secondary"
          >
            <Ticket className="size-4" />
            My bookings
          </Link>
        </div>
      </section>

      {/* Bus pass — the headline widget */}
      {activeBooking && (
        <BusPassCard
          routeName={activeBooking.routeName}
          billingPeriod={activeBooking.billing_period}
          status={activeBooking.status}
          isPaid={activeBooking.is_paid}
          paymentStatus={activeBooking.payment_status}
          startIso={passStart}
          pickupName={pickupName}
          busNumber={busNumber}
          manageHref="/student/bookings"
          renewHref={passRenewHref}
        />
      )}

      {/* Live bus tracking for the active ride */}
      {trackRouteId && (
        <section className="space-y-3">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-semibold">
              <MapPin className="size-5 text-primary" /> Track your bus
            </h2>
            <p className="text-sm text-muted-foreground">
              Live location shows while the driver is online for your ride.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-xs">
            <RouteStopsMap
              stops={trackStops}
              liveRouteId={trackRouteId}
              heightClass="h-[28rem] sm:h-[34rem] lg:h-[38rem]"
            />
          </div>
        </section>
      )}

      {/* Main grid: quick actions + recent trips */}
      <section className="grid gap-5 lg:grid-cols-5">
        <div className="grid gap-5 sm:grid-cols-2 lg:col-span-3 lg:content-start">
          <Link
            href="/student/schools"
            className="group flex flex-col gap-3 rounded-2xl border border-border bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
          >
            <span className="grid size-11 place-items-center rounded-xl bg-secondary text-foreground">
              <Search className="size-6" />
            </span>
            <h2 className="text-lg font-semibold">Browse campuses</h2>
            <p className="text-sm text-muted-foreground">
              Find your school or college, pick an agency and reserve a seat.
            </p>
            <span className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary">
              Start booking
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>

          <Link
            href="/student/bookings"
            className="group flex flex-col gap-3 rounded-2xl border border-border bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
          >
            <span className="grid size-11 place-items-center rounded-xl bg-secondary text-foreground">
              <Ticket className="size-6" />
            </span>
            <h2 className="text-lg font-semibold">My bookings</h2>
            <p className="text-sm text-muted-foreground">
              View, track and cancel your reservations.
            </p>
            <span className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary">
              View bookings
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>

          {/* Booking status breakdown */}
          <div className="rounded-2xl border border-border bg-card p-6 shadow-xs sm:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Booking overview</h2>
              <span className="text-sm text-muted-foreground"><span className="tnum font-semibold text-foreground">{totalBookings}</span> total</span>
            </div>
            {totalBookings === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                No bookings yet — your reservation history will appear here.
              </p>
            ) : (
              <>
                <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  {breakdown.map((b) => (
                    <div
                      key={b.status}
                      className={(STATUS_META[b.status] ?? STATUS_META.PENDING).bar}
                      style={{ width: `${(b.count / totalBookings) * 100}%` }}
                    />
                  ))}
                </div>
                <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {breakdown.map((b) => {
                    const meta = STATUS_META[b.status] ?? STATUS_META.PENDING;
                    return (
                      <li key={b.status} className="flex items-center gap-2">
                        <span className={`size-2.5 shrink-0 rounded-full ${meta.dot}`} />
                        <span className="text-sm">
                          <span className="tnum font-semibold">{b.count}</span>{' '}
                          <span className="text-muted-foreground">{meta.label}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </div>

        {/* Recent trips */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-xs lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent bookings</h2>
            {recent.length > 0 && (
              <Link
                href="/student/bookings"
                className="text-sm font-medium text-primary transition-colors hover:text-primary/70"
              >
                See all
              </Link>
            )}
          </div>

          {recent.length === 0 ? (
            <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-10 text-center">
              <span className="grid size-11 place-items-center rounded-full bg-secondary text-muted-foreground">
                <Ticket className="size-5" />
              </span>
              <p className="text-sm text-muted-foreground">
                No bookings yet — reserve your first seat.
              </p>
              <Link
                href="/student/schools"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/70"
              >
                Browse campuses
                <ArrowRight className="size-4" />
              </Link>
            </div>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {recent.map((b) => {
                const meta = STATUS_META[b.status] ?? STATUS_META.PENDING;
                return (
                  <li
                    key={b.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/50 px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={`size-2 shrink-0 rounded-full ${meta.dot}`} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{b.routeName}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatShortDate(b.created_at)}
                        </p>
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${meta.pill}`}>
                      {meta.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Explore campuses */}
      {featured.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-end justify-between">
            <h2 className="text-xl font-semibold">Explore campuses</h2>
            <Link
              href="/student/schools"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary/70"
            >
              View all
              <ArrowRight className="size-4" />
            </Link>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((i) => (
              <Link
                key={i.id}
                href={`/student/schools/${i.id}`}
                className="group overflow-hidden rounded-2xl border border-border bg-card transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
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
                  <span className="flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
                    <MapPin className="size-3.5" />
                    {i.kind === 'COLLEGE' ? 'College' : 'School'}
                  </span>
                  <h3 className="flex items-center gap-1.5 font-semibold">
                    {i.name}
                    <VerifiedBadge verified={i.is_verified} />
                  </h3>
                  {i.description && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">{i.description}</p>
                  )}
                  <span className="inline-flex items-center gap-1 pt-1 text-sm font-medium text-primary">
                    View campus
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Pre-booking info — below Explore, only until the rider has an active pass. */}
      {preBooking && (
        <PreBookingInfo role="student" stats={stats} helpHref="/student/help" />
      )}
    </div>
  );
}
