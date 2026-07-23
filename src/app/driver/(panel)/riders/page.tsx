import { redirect } from 'next/navigation';
import { Bus, MapPin, Route as RouteIcon, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
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
  const [bookings, riders] = await Promise.all([
    listDriverBookings(db, { limit: PAGE_SIZE, offset }),
    countDriverBookings(db),
  ]);
  const totalPages = Math.max(1, Math.ceil(riders.total / PAGE_SIZE));
  if (riders.total > 0 && page > totalPages) redirect(`/driver/riders?page=${totalPages}`);

  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <p className="text-xs font-semibold tracking-wider text-primary uppercase">Roster</p>
        <h1 className="text-2xl font-heading font-bold tracking-tight sm:text-3xl">My Riders</h1>
        <p className="text-muted-foreground">
          Tap a stage as the trip goes — the student and their parents get an
          instant update when they board, reach campus, and get off.
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {bookings.map((b) => {
            const initials = (b.student_name ?? '')
              .split(' ')
              .filter(Boolean)
              .map((p) => p[0])
              .slice(0, 2)
              .join('')
              .toUpperCase();
            return (
              <Card key={b.booking_id} className="h-full">
                <CardContent className="space-y-3 py-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/12 text-sm font-semibold text-primary">
                        {initials || <Users className="size-4" />}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{b.student_name ?? '—'}</p>
                        <p className="truncate text-xs text-muted-foreground">{b.student_phone ?? '—'}</p>
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
                    <p className="flex items-center gap-1.5">
                      <MapPin className="size-3.5 shrink-0" /> {b.pickup_name ?? '—'}
                    </p>
                    <p className="flex items-center gap-1.5">
                      <RouteIcon className="size-3.5 shrink-0" />
                      {b.route_name ? `${b.route_name} → ${b.college_name ?? 'campus'}` : '—'}
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
            );
          })}
        </div>
      )}
      <Pager page={page} totalPages={totalPages} basePath="/driver/riders" />
    </section>
  );
}
