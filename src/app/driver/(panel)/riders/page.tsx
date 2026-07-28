import { Fragment } from 'react';
import { redirect } from 'next/navigation';
import { Bus, MapPin, Navigation, Phone, Route as RouteIcon, SkipForward, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { isAppRequest } from '@/lib/app-context';
import { listDriverBookings, countDriverBookings } from '@/features/driver/repository';
import { Card, CardContent } from '@/components/ui/card';
import { Pager, pageParams } from '@/components/pager';
import { cn } from '@/lib/utils';
import { RideStageControl } from './ride-stage-control';

const LABEL: Record<string, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
};

// Tinted status pill per booking status — same strings/keys as before, just styled.
const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-[color:var(--warning)]/12 text-[color:var(--warning)]',
  CONFIRMED: 'bg-[color:var(--success)]/12 text-[color:var(--success)]',
};

const PAGE_SIZE = 25;

export default async function DriverRidersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, PAGE_SIZE);
  const db = await createClient();
  // Paginate: the roster is CONFIRMED (+PENDING) bookings on the driver's buses,
  // which are never archived and grow across terms.
  const [bookings, riders, app] = await Promise.all([
    listDriverBookings(db, { limit: PAGE_SIZE, offset }),
    countDriverBookings(db),
    isAppRequest(),
  ]);
  const totalPages = Math.max(1, Math.ceil(riders.total / PAGE_SIZE));
  if (riders.total > 0 && page > totalPages) redirect(`/driver/riders?page=${totalPages}`);

  return (
    <section className="space-y-5">
      <div className="space-y-1">
        {!app && (
          <p className="text-xs font-semibold tracking-wider text-primary uppercase">Roster</p>
        )}
        <h1 className="text-2xl font-heading font-bold tracking-tight sm:text-3xl">My Riders</h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          {app
            ? 'In pickup order — top of the list is your next stop. Tap a stage as the trip goes.'
            : 'Listed in pickup order along each route — top of the list is your next stop. Tap a stage as the trip goes and the student and their parents get an instant update when they board, reach campus, and get off.'}
        </p>
      </div>

      {bookings.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <Users className="size-6" />
            </span>
            <p className="text-sm text-muted-foreground">No riders booked yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className={cn('grid grid-cols-1 gap-4', !app && 'sm:grid-cols-2')}>
          {bookings.map((b, idx) => {
            const initials = (b.student_name ?? '')
              .split(' ')
              .filter(Boolean)
              .map((p) => p[0])
              .slice(0, 2)
              .join('')
              .toUpperCase();
            // The roster arrives grouped by route in stop order — start a new
            // full-width route header whenever the route changes.
            const prev = idx > 0 ? bookings[idx - 1] : null;
            const showRouteHeader = !prev || prev.route_id !== b.route_id;
            const isNext = b.pickup_status === 'NEXT';
            const isSkipped = b.pickup_status === 'SKIPPED';
            return (
              <Fragment key={b.booking_id}>
                {showRouteHeader && (
                  <div className="flex items-center gap-2 pt-1 sm:col-span-2">
                    <RouteIcon className="size-4 shrink-0 text-primary" />
                    <p className="text-sm font-semibold">
                      {b.route_name ? `${b.route_name} → ${b.college_name ?? 'campus'}` : 'Route'}
                    </p>
                    {b.bus_number && (
                      <span className="text-xs text-muted-foreground">· Bus {b.bus_number}</span>
                    )}
                  </div>
                )}
                <Card
                  className={cn(
                    'h-full',
                    isNext && 'ring-2 ring-primary',
                    isNext && app && 'bg-primary/[0.06]',
                    isSkipped && 'opacity-70',
                  )}
                >
                  <CardContent className={cn('space-y-3 py-5', app && 'space-y-3.5')}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className={cn(
                            'relative grid shrink-0 place-items-center rounded-full bg-primary/12 font-semibold text-primary',
                            app ? 'size-12 text-base' : 'size-10 text-sm',
                          )}
                        >
                          {initials || <Users className="size-4" />}
                          {b.pickup_sequence != null && (
                            <span className="absolute -top-1.5 -left-1.5 grid size-5 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground tnum">
                              {b.pickup_sequence}
                            </span>
                          )}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{b.student_name ?? '—'}</p>
                          {app && b.student_phone ? (
                            // Tap-to-call in the app.
                            <a
                              href={`tel:${b.student_phone}`}
                              className="inline-flex items-center gap-1 text-xs font-medium text-primary"
                            >
                              <Phone className="size-3" /> {b.student_phone}
                            </a>
                          ) : (
                            <p className="truncate text-xs text-muted-foreground">{b.student_phone ?? '—'}</p>
                          )}
                        </div>
                      </div>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                          STATUS_STYLE[b.status] ?? 'bg-muted text-muted-foreground',
                        )}
                      >
                        {LABEL[b.status] ?? b.status}
                      </span>
                    </div>

                    <div className="space-y-1 text-sm text-muted-foreground">
                      <p className="flex flex-wrap items-center gap-1.5">
                        <MapPin className="size-3.5 shrink-0" /> {b.pickup_name ?? '—'}
                        {isNext && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-semibold text-primary">
                            <Navigation className="size-3" /> Next pickup
                          </span>
                        )}
                        {isSkipped && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--warning)]/12 px-2 py-0.5 text-[11px] font-semibold text-[color:var(--warning)]">
                            <SkipForward className="size-3" /> Skipped today
                          </span>
                        )}
                      </p>
                      <p className="flex items-center gap-1.5">
                        <Bus className="size-3.5 shrink-0" /> {b.bus_number ? `Bus ${b.bus_number}` : '—'}
                      </p>
                    </div>

                    <div className="border-t border-border pt-3">
                      <RideStageControl
                        bookingId={b.booking_id}
                        studentName={b.student_name ?? ''}
                        currentStage={b.current_stage}
                      />
                    </div>
                  </CardContent>
                </Card>
              </Fragment>
            );
          })}
        </div>
      )}
      <Pager page={page} totalPages={totalPages} basePath="/driver/riders" />
    </section>
  );
}
