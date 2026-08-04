import Link from 'next/link';
import {
  Search,
  Ticket,
  Compass,
  History,
  ArrowRight,
  MapPin,
  Navigation,
} from 'lucide-react';
import { InstitutionLogo } from '@/components/institution-logo';
import { VerifiedBadge } from '@/components/verified-badge';
import { BusPassCard } from '@/components/bus-pass-card';
import { PreBookingInfo } from '@/components/pre-booking-info';
import RouteStopsMap, { type MapStop } from '@/app/(dashboard)/student/routes/[id]/route-stops-map';
import type { Kind } from '@/features/catalog/repository';
import type { BillingPeriod } from '@/lib/billing';
import type { PublicStats } from '@/lib/public-stats';

type ActiveTrip = {
  routeName: string | null;
  status: string;
  isPaid: boolean;
  paymentStatus: string | null;
  billingPeriod: BillingPeriod | null;
  /** paid_at ?? created_at — the pass-window start. */
  startIso: string | null;
  pickupName: string | null;
  busNumber: string | null;
  route_id: string | null;
} | null;

type Campus = {
  id: string;
  name: string;
  kind: Kind;
  image_url: string | null;
  is_verified: boolean;
};

/**
 * Native-app home for students — a compact daily hub (not the website's long
 * marketing dashboard). Greeting, a big "find your campus" search entry, the
 * active ride front-and-centre with Track live / Manage, quick-action chips, and
 * a swipeable campus carousel. Rendered only inside the app; the website keeps
 * its full dashboard.
 */
export function AppStudentHome({
  name,
  dateLabel,
  active,
  campuses,
  trackRouteId,
  trackStops = [],
  stats,
  helpHref,
}: {
  name: string;
  dateLabel: string;
  active: ActiveTrip;
  campuses: Campus[];
  trackRouteId?: string | null;
  trackStops?: MapStop[];
  stats: PublicStats;
  helpHref: string;
}) {
  return (
    <div className="space-y-7 pb-2">
      {/* Greeting */}
      <section>
        <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
          <span aria-hidden className="size-1.5 rounded-full bg-primary" />
          <span className="tnum">{dateLabel}</span>
        </div>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          Hi <span className="text-gradient">{name}</span> 👋
        </h1>
      </section>

      {/* Primary browse entry — looks like a search field, taps into browsing. */}
      <Link
        href="/student/schools"
        className="group flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-4 shadow-sm transition-colors hover:border-primary/40"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Search className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Find your campus</span>
          <span className="block truncate text-xs text-muted-foreground">
            Browse schools &amp; colleges, then pick a route
          </span>
        </span>
        <ArrowRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </Link>

      {/* Active ride — bus pass + live map */}
      {active ? (
        <section className="space-y-3">
          <BusPassCard
            routeName={active.routeName}
            billingPeriod={active.billingPeriod}
            status={active.status}
            isPaid={active.isPaid}
            paymentStatus={active.paymentStatus}
            startIso={active.startIso}
            pickupName={active.pickupName}
            busNumber={active.busNumber}
            manageHref="/student/bookings"
            renewHref={active.route_id ? `/student/routes/${active.route_id}` : '/student/schools'}
            compact
          />
          {/* Live bus map right in the home */}
          {trackRouteId ? (
            <div className="space-y-2 rounded-2xl border border-border bg-card p-3 shadow-xs">
              <p className="flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
                <Navigation className="size-3.5 text-primary" /> Live location — shows while the driver is online
              </p>
              <RouteStopsMap stops={trackStops} liveRouteId={trackRouteId} heightClass="h-[26rem] sm:h-[30rem]" />
            </div>
          ) : (
            <p className="px-1 text-xs text-muted-foreground">
              Live tracking starts once your seat is confirmed.
            </p>
          )}
        </section>
      ) : (
        <section className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card/50 px-5 py-8 text-center">
          <span className="grid size-11 place-items-center rounded-full bg-secondary text-muted-foreground">
            <Ticket className="size-5" />
          </span>
          <p className="text-sm text-muted-foreground">
            No active ride yet — reserve your seat for the daily route to class.
          </p>
          <Link
            href="/student/schools"
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            <Search className="size-4" />
            Browse campuses
          </Link>
        </section>
      )}

      {/* Quick actions */}
      <section className="grid grid-cols-3 gap-3">
        <QuickChip href="/student/schools" icon={<Compass className="size-5" />} label="Browse" />
        <QuickChip href="/student/bookings" icon={<Ticket className="size-5" />} label="Bookings" />
        <QuickChip href="/student/history" icon={<History className="size-5" />} label="History" />
      </section>

      {/* Pre-booking info — only until the rider has an active pass. */}
      {!active && <PreBookingInfo role="student" stats={stats} helpHref={helpHref} compact />}

      {/* Explore campuses — horizontal swipe carousel */}
      {campuses.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Explore campuses</h2>
            <Link
              href="/student/schools"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary"
            >
              See all
              <ArrowRight className="size-4" />
            </Link>
          </div>
          {/* Bleed to the screen edges so cards can peek off-screen (native feel). */}
          <div className="-mx-4 flex snap-x snap-mandatory gap-3.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {campuses.map((c) => (
              <Link
                key={c.id}
                href={`/student/schools/${c.id}`}
                className="group w-44 shrink-0 snap-start overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-primary/40"
              >
                <div
                  className="relative flex h-20 items-end px-4"
                  style={{
                    background:
                      'linear-gradient(135deg, color-mix(in oklch, var(--primary) 26%, transparent), color-mix(in oklch, var(--chart-5) 24%, transparent))',
                  }}
                >
                  <div aria-hidden className="absolute inset-0 opacity-60 bg-grid" />
                  <InstitutionLogo
                    name={c.name}
                    kind={c.kind}
                    imageUrl={c.image_url}
                    className="relative -mb-6 size-12 ring-2 ring-background"
                    iconClassName="size-5"
                  />
                </div>
                <div className="space-y-1 p-4 pt-8">
                  <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <MapPin className="size-3" />
                    {c.kind === 'COLLEGE' ? 'College' : 'School'}
                  </span>
                  <h3 className="flex items-center gap-1 truncate text-sm font-semibold">
                    <span className="truncate">{c.name}</span>
                    <VerifiedBadge verified={c.is_verified} />
                  </h3>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function QuickChip({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card px-2 py-4 text-center transition-colors hover:border-primary/40 hover:bg-secondary"
    >
      <span className="grid size-10 place-items-center rounded-xl bg-secondary text-foreground">
        {icon}
      </span>
      <span className="text-xs font-medium">{label}</span>
    </Link>
  );
}
