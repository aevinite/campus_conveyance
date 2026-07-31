import Link from 'next/link';
import {
  Search,
  Ticket,
  ArrowRight,
  Bus,
  Sparkles,
  MapPin,
  ShieldCheck,
  LifeBuoy,
  CalendarClock,
} from 'lucide-react';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { isAppRequest } from '@/lib/app-context';
import { getSessionClaims } from '@/features/auth/session';
import { listRecentBookings, myBookingStatusCounts } from '@/features/booking/repository';
import { listFeaturedInstitutions } from '@/features/catalog/repository';
import { InstitutionLogo } from '@/components/institution-logo';
import { VerifiedBadge } from '@/components/verified-badge';
import { AppStudentHome } from '@/components/app-student-home';
import RouteStopsMap, { type MapStop } from './routes/[id]/route-stops-map';
import { formatShortDate, formatWeekdayDate } from '@/lib/format-date';

// Bookings whose bus is worth showing a live map for.
const TRACKABLE = new Set(['CONFIRMED', 'PENDING']);

const STATUS_META: Record<
  string,
  { label: string; dot: string; pill: string; bar: string }
> = {
  CONFIRMED: {
    label: 'Confirmed',
    dot: 'bg-success',
    pill: 'border-success/30 bg-success/10 text-success',
    bar: 'bg-success',
  },
  WAITLISTED: {
    label: 'Waitlisted',
    dot: 'bg-warning',
    pill: 'border-warning/30 bg-warning/10 text-warning',
    bar: 'bg-warning',
  },
  PENDING: {
    label: 'Pending',
    dot: 'bg-primary',
    pill: 'border-primary/30 bg-primary/10 text-primary',
    bar: 'bg-primary',
  },
  CANCELLED: {
    label: 'Cancelled',
    dot: 'bg-muted-foreground',
    pill: 'border-border bg-muted text-muted-foreground',
    bar: 'bg-muted-foreground',
  },
  REJECTED: {
    label: 'Rejected',
    dot: 'bg-destructive',
    pill: 'border-destructive/30 bg-destructive/10 text-destructive',
    bar: 'bg-destructive',
  },
};


const STEPS = [
  {
    icon: Search,
    title: 'Pick your campus',
    body: 'Choose your school or college from the list.',
  },
  {
    icon: Bus,
    title: 'Pick your bus',
    body: 'One list of every route — compare fares, timings and live seats.',
  },
  {
    icon: Ticket,
    title: 'Request, then pay',
    body: 'Request a seat; once the agency approves, pay within 10 minutes to confirm it.',
  },
];

export default async function StudentHome() {
  await requireRole('STUDENT');
  const db = await createClient();
  // In the native app the hero subtitle is dropped (kept for the website only).
  const app = await isAppRequest();
  const [{ fullName }, recentRows, statusCounts, featured] = await Promise.all([
    getSessionClaims(db),
    // Only the few rows the home actually shows, not the whole history + driver
    // overlay; counts come from a SQL GROUP BY, institutions from head counts.
    listRecentBookings(db, 8),
    myBookingStatusCounts(db),
    listFeaturedInstitutions(db, 12),
  ]);
  const name = (fullName ?? 'there').split(' ')[0];

  const active = recentRows.filter((b) => b.status !== 'CANCELLED' && b.status !== 'REJECTED');
  const recent = recentRows.slice(0, 4);
  const nextTrip = active.find((b) => b.status === 'CONFIRMED') ?? active[0] ?? null;

  // Live bus map for the active ride: fetch its stops once (only when trackable).
  const trackRouteId =
    nextTrip && nextTrip.route_id && TRACKABLE.has(nextTrip.status) ? nextTrip.route_id : null;
  let trackStops: MapStop[] = [];
  if (trackRouteId) {
    const { data: stopRows } = await db
      .from('route_stops')
      .select('name, lat, lng, description, address, sequence')
      .eq('route_id', trackRouteId)
      .order('sequence');
    trackStops = (stopRows ?? []).map((s) => ({
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      description: s.description,
      address: s.address,
    }));
  }


  // Status breakdown for the mini bar chart (only non-empty buckets).
  // Cancelled bookings are hidden from the student panel entirely.
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
          nextTrip
            ? {
                routeName: nextTrip.routeName,
                status: nextTrip.status,
                created_at: nextTrip.created_at,
                route_id: nextTrip.route_id,
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
          {!app && (
            <p className="mt-3 max-w-xl text-muted-foreground">
              Browse your campus, choose a bus or van from a verified agency, and
              reserve your seat for the daily route to class.
            </p>
          )}
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

      {/* Next trip highlight */}
      {nextTrip && (
        <section className="flex flex-col gap-4 rounded-2xl border border-primary/30 bg-primary/[0.06] p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
              <CalendarClock className="size-6" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-primary">
                Your active booking
              </p>
              <p className="mt-0.5 truncate text-lg font-semibold">{nextTrip.routeName}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                    (STATUS_META[nextTrip.status] ?? STATUS_META.PENDING).pill
                  }`}
                >
                  {(STATUS_META[nextTrip.status] ?? STATUS_META.PENDING).label}
                </span>
                <span>Booked {formatShortDate(nextTrip.created_at)}</span>
              </p>
            </div>
          </div>
          <Link
            href="/student/bookings"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold transition-colors hover:bg-secondary"
          >
            Manage
            <ArrowRight className="size-4" />
          </Link>
        </section>
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
            <RouteStopsMap stops={trackStops} liveRouteId={trackRouteId} />
          </div>
        </section>
      )}

      {/* Main grid: quick actions + recent trips */}
      <section className="grid gap-5 lg:grid-cols-5">
        {/* Quick actions */}
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
            <div>
              <h2 className="text-xl font-semibold">Explore campuses</h2>
            </div>
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

      {/* How it works */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-xs sm:p-8">
        <h2 className="text-xl font-semibold">How booking works</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Three simple steps from campus to confirmed seat.
        </p>
        <ol className="mt-6 grid gap-6 sm:grid-cols-3">
          {STEPS.map((step, idx) => (
            <li key={step.title} className="relative flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                  <step.icon className="size-5" />
                </span>
                <span className="text-sm font-semibold text-muted-foreground">
                  Step {idx + 1}
                </span>
              </div>
              <h3 className="font-semibold">{step.title}</h3>
              <p className="text-sm text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Safety / help banner */}
      <section className="grid gap-5 sm:grid-cols-2">
        <div className="flex items-start gap-4 rounded-2xl border border-border bg-card p-6 shadow-xs">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-success/10 text-success">
            <ShieldCheck className="size-6" />
          </span>
          <div>
            <h3 className="font-semibold">Trusted &amp; verified agencies</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Every agency on Campus Conveyance is reviewed before it can offer
              routes, so you travel with peace of mind.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-4 rounded-2xl border border-border bg-card p-6 shadow-xs">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[color:var(--viz-students)]/12 text-[color:var(--viz-students)]">
            <LifeBuoy className="size-6" />
          </span>
          <div>
            <h3 className="font-semibold">Need a hand?</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage or cancel a reservation anytime from{' '}
              <Link href="/student/bookings" className="font-medium text-primary hover:text-primary/70">
                My bookings
              </Link>
              , or update your details in your profile.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
