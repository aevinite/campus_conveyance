import { Bus, MapPin, Receipt, LogIn, Flag, LogOut, Clock3, Ticket } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { periodSuffix } from '@/lib/billing';
import { formatCompactDateTime, formatShortDate } from '@/lib/format-date';
import type { RideHistoryRow } from '@/features/history/repository';

const inr = (cents: number | null) =>
  cents == null || cents === 0
    ? null
    : `₹${Math.round(cents / 100).toLocaleString('en-IN')}`;

const STAGE: Record<string, { label: string; Icon: typeof LogIn; cls: string }> = {
  BOARDED: { label: 'Boarded the bus', Icon: LogIn, cls: 'text-primary' },
  REACHED: { label: 'Reached campus', Icon: Flag, cls: 'text-success' },
  GOT_OFF: { label: 'Got off', Icon: LogOut, cls: 'text-muted-foreground' },
};

const STATUS_PILL: Record<string, string> = {
  CONFIRMED: 'border-success/30 bg-success/10 text-success',
  CANCELLED: 'border-border bg-muted text-muted-foreground',
};

/**
 * Family-facing trip history: one card per booking with its receipt (route, bus,
 * pickup, fare, paid date, reference) and the ride-event timeline. Shared by the
 * student and parent history pages. Purely presentational (server component).
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
          Once a booking is confirmed and the ride happens, it&apos;ll show up here with a receipt
          and the boarding timeline.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {rows.map((b) => {
        const fare = inr(b.price_cents);
        const events = b.events.slice(0, 8);
        return (
          <Card key={b.booking_id}>
            <CardContent className="space-y-4 py-5">
              {/* Header: route + status */}
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {b.route_name ?? 'Route'}
                    {b.college_name ? (
                      <span className="text-muted-foreground"> → {b.college_name}</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[b.student_name, b.agency_name].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                    STATUS_PILL[b.status] ?? 'border-border bg-muted text-muted-foreground'
                  }`}
                >
                  {b.status === 'CONFIRMED' ? 'Confirmed' : 'Cancelled'}
                </span>
              </div>

              {/* Receipt */}
              <div className="grid gap-x-6 gap-y-1.5 rounded-xl bg-muted/30 p-3 text-sm sm:grid-cols-2">
                {b.bus_number && (
                  <p className="flex items-center gap-1.5 text-muted-foreground">
                    <Bus className="size-3.5 shrink-0" /> Bus {b.bus_number}
                  </p>
                )}
                {b.pickup_name && (
                  <p className="flex items-center gap-1.5 text-muted-foreground">
                    <MapPin className="size-3.5 shrink-0" /> {b.pickup_name}
                  </p>
                )}
                {fare && (
                  <p className="flex items-center gap-1.5 text-muted-foreground">
                    <Receipt className="size-3.5 shrink-0" />
                    <span className="tnum font-medium text-foreground">
                      {fare}
                      {periodSuffix(b.billing_period)}
                    </span>
                    {b.paid_at && <span>· paid {formatShortDate(b.paid_at)}</span>}
                  </p>
                )}
                <p className="flex items-center gap-1.5 text-muted-foreground">
                  <Ticket className="size-3.5 shrink-0" />
                  Ref {b.booking_id.slice(0, 8).toUpperCase()}
                </p>
              </div>

              {/* Ride-event timeline */}
              {events.length > 0 ? (
                <ol className="space-y-2 text-sm">
                  {events.map((e, i) => {
                    const s = STAGE[e.stage] ?? {
                      label: e.stage,
                      Icon: Clock3,
                      cls: 'text-muted-foreground',
                    };
                    return (
                      <li key={i} className="flex items-center gap-2.5">
                        <s.Icon className={`size-4 shrink-0 ${s.cls}`} />
                        <span className="font-medium">{s.label}</span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {formatCompactDateTime(e.at)}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No boarding activity recorded for this ride yet.
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
