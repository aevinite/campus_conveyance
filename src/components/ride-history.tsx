import { Bus, MapPin, Flag, LogOut, LogIn, Ticket } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { formatDateMedium, formatTime } from '@/lib/format-date';
import type { RideHistoryRow } from '@/features/history/repository';

/**
 * Family-facing trip history: one card per ride the student actually took —
 * anchored on the date + time the driver marked them boarded — newest first.
 * Cancelled / never-ridden bookings never appear (filtered in SQL). Shared by
 * the student and parent history pages. Purely presentational (server component).
 */
export function RideHistory({ rows }: { rows: RideHistoryRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border py-16 text-center">
        <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
          <Ticket className="size-6" />
        </span>
        <p className="font-semibold">No rides yet</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          Once you board a bus and the driver marks you boarded, that ride shows
          up here with its date and time.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {rows.map((t) => (
        <Card key={t.ride_id}>
          <CardContent className="space-y-3 py-5">
            {/* Boarding date + time — the anchor of the trip. */}
            <div className="flex items-center gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <LogIn className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold tnum">{formatDateMedium(t.boarded_at)}</p>
                <p className="text-sm text-muted-foreground">
                  Boarded at <span className="tnum font-medium text-foreground">{formatTime(t.boarded_at)}</span>
                </p>
              </div>
            </div>

            {/* Route → college */}
            <p className="text-sm font-medium">
              {t.route_name ?? 'Route'}
              {t.college_name ? <span className="text-muted-foreground"> → {t.college_name}</span> : null}
            </p>
            {(t.student_name || t.agency_name) && (
              <p className="-mt-2 text-xs text-muted-foreground">
                {[t.student_name, t.agency_name].filter(Boolean).join(' · ')}
              </p>
            )}

            {/* Bus + pickup */}
            {(t.bus_number || t.pickup_name) && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {t.bus_number && (
                  <span className="inline-flex items-center gap-1.5">
                    <Bus className="size-3.5 shrink-0" /> Bus {t.bus_number}
                  </span>
                )}
                {t.pickup_name && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="size-3.5 shrink-0" /> {t.pickup_name}
                  </span>
                )}
              </div>
            )}

            {/* That day's reached / got-off times (if the driver recorded them). */}
            {(t.reached_at || t.got_off_at) && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-sm">
                {t.reached_at && (
                  <span className="inline-flex items-center gap-1.5 text-success">
                    <Flag className="size-3.5 shrink-0" /> Reached{' '}
                    <span className="tnum font-medium">{formatTime(t.reached_at)}</span>
                  </span>
                )}
                {t.got_off_at && (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <LogOut className="size-3.5 shrink-0" /> Got off{' '}
                    <span className="tnum font-medium">{formatTime(t.got_off_at)}</span>
                  </span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
