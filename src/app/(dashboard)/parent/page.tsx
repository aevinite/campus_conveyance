import { Bus, GraduationCap, MapPin, Phone, Ticket, UserCircle } from 'lucide-react';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/features/auth/session';
import { listChildren, listChildrenBookings } from '@/features/parent/repository';
import RouteStopsMap, {
  type MapStop,
} from '../student/routes/[id]/route-stops-map';
import { LinkChildForm } from './link-child-form';
import { UnlinkChildButton } from './unlink-child-button';

// Bookings the child could actually be riding — worth showing a live bus map for.
const TRACKABLE = new Set(['CONFIRMED', 'PENDING']);

const STATUS_PILL: Record<string, string> = {
  CONFIRMED: 'border-success/30 bg-success/10 text-success',
  WAITLISTED: 'border-warning/30 bg-warning/10 text-warning',
  PENDING: 'border-primary/30 bg-primary/10 text-primary',
  CANCELLED: 'border-border bg-muted text-muted-foreground',
};

const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: 'Confirmed',
  WAITLISTED: 'Waitlisted',
  PENDING: 'Pending',
  CANCELLED: 'Cancelled',
};

const shortDate = new Intl.DateTimeFormat('en-IN', { month: 'short', day: 'numeric' });

export default async function ParentDashboard() {
  await requireRole('PARENT');
  const db = await createClient();
  const [{ fullName }, children, bookings] = await Promise.all([
    getSessionClaims(db),
    listChildren(db),
    listChildrenBookings(db),
  ]);
  const name = (fullName ?? 'there').split(' ')[0];

  // Active trips get a live bus map. Fetch each route's stops once (public-read)
  // so the map has context; the bus marker itself is polled client-side.
  const trackable = bookings.filter((b) => b.route_id && TRACKABLE.has(b.status));
  const routeIds = [...new Set(trackable.map((b) => b.route_id as string))];
  const stopsByRoute = new Map<string, MapStop[]>();
  if (routeIds.length > 0) {
    const { data: stopRows } = await db
      .from('route_stops')
      .select('route_id, name, lat, lng, description, address, sequence')
      .in('route_id', routeIds)
      .order('sequence');
    for (const s of stopRows ?? []) {
      const list = stopsByRoute.get(s.route_id) ?? [];
      list.push({ name: s.name, lat: s.lat, lng: s.lng, description: s.description, address: s.address });
      stopsByRoute.set(s.route_id, list);
    }
  }

  return (
    <div className="space-y-8">
      {/* Greeting */}
      <section className="relative overflow-hidden rounded-3xl border border-border bg-card p-7 shadow-sm sm:p-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(80% 130% at 100% 0%, color-mix(in oklch, var(--primary) 22%, transparent), transparent 62%)',
          }}
        />
        <div aria-hidden className="pointer-events-none absolute -right-10 -bottom-16 -z-10 opacity-[0.07]">
          <UserCircle className="size-64" />
        </div>
        <h1 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
          Welcome, <span className="text-primary">{name}</span>.
        </h1>
        <p className="mt-3 max-w-xl text-muted-foreground">
          Link your children&apos;s student accounts to follow their bookings,
          buses and drivers — all in one place.
        </p>
      </section>

      <LinkChildForm />

      {/* Live bus tracking — one map per active child trip. The map shows the
          route's stops and a live marker while the driver is online. */}
      {trackable.length > 0 && (
        <section className="space-y-4">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-semibold">
              <MapPin className="size-5 text-primary" /> Track their bus
            </h2>
            <p className="text-sm text-muted-foreground">
              Live location shows while the driver is online for the trip.
            </p>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            {trackable.map((b) => (
              <div
                key={b.booking_id}
                className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{b.student_name ?? 'Your child'}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {[b.route_name, b.institution_name].filter(Boolean).join(' → ')}
                    </p>
                  </div>
                  {b.bus_number && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-1 text-xs font-medium text-muted-foreground">
                      <Bus className="size-3.5" /> Bus {b.bus_number}
                    </span>
                  )}
                </div>
                <RouteStopsMap
                  stops={stopsByRoute.get(b.route_id as string) ?? []}
                  liveRouteId={b.route_id as string}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Children */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Your children</h2>
        {children.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No children linked yet — enter the 6-digit code from your child&apos;s
            student profile above to see their trips here.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {children.map((c) => (
              <div key={c.student_id} className="rounded-2xl border border-border bg-card p-5 shadow-xs">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                      <GraduationCap className="size-5" />
                    </span>
                    <div>
                      <p className="font-semibold">{c.full_name ?? 'Student'}</p>
                      <p className="text-sm text-muted-foreground">{c.email}</p>
                    </div>
                  </div>
                  <UnlinkChildButton studentId={c.student_id} />
                </div>
                <div className="mt-3 space-y-0.5 text-sm text-muted-foreground">
                  {c.grade && <p>Class: {c.grade}</p>}
                  {c.phone && (
                    <p className="inline-flex items-center gap-1.5">
                      <Phone className="size-3.5" /> {c.phone}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Bookings */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Their bookings</h2>
        {bookings.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border py-12 text-center">
            <span className="grid size-11 place-items-center rounded-full bg-secondary text-muted-foreground">
              <Ticket className="size-5" />
            </span>
            <p className="text-sm text-muted-foreground">
              {children.length === 0
                ? 'Bookings will appear here once you link a child.'
                : 'No bookings yet — they will appear here as soon as your child reserves a seat.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {bookings.map((b) => (
              <div
                key={b.booking_id}
                className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-xs sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2 font-medium">
                    {b.route_name ?? 'Route'}
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                        STATUS_PILL[b.status] ?? STATUS_PILL.PENDING
                      }`}
                    >
                      {STATUS_LABEL[b.status] ?? b.status}
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {[
                      b.student_name,
                      b.institution_name,
                      b.pickup_name && `Pickup: ${b.pickup_name}`,
                      `Booked ${shortDate.format(new Date(b.created_at))}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {(b.bus_number || b.driver_name) && (
                    <p className="mt-1 inline-flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                      {b.bus_number && (
                        <span className="inline-flex items-center gap-1.5">
                          <Bus className="size-3.5" /> Bus {b.bus_number}
                        </span>
                      )}
                      {b.driver_name && (
                        <span>
                          Driver: {b.driver_name}
                          {b.driver_phone ? ` (${b.driver_phone})` : ''}
                        </span>
                      )}
                      {b.driver_changed && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                          Driver changed for today
                        </span>
                      )}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
