import { Bus, MapPin, Ticket, CheckCircle2, XCircle, IndianRupee } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { formatDateMedium } from '@/lib/format-date';
import { periodLabel, type BillingPeriod } from '@/lib/billing';
import type { BookingHistoryRow } from '@/features/history/repository';

// What a cancelled booking's refund ended up as — shown next to "Cancelled".
const REFUND_LABEL: Record<BookingHistoryRow['refund_status'], string | null> = {
  NONE: null,
  REQUESTED: 'Refund requested',
  PROCESSED: 'Refund processed',
  DECLINED: 'Refund declined',
};

function rupees(cents: number): string {
  return `₹${Math.round(cents / 100).toLocaleString('en-IN')}`;
}

/**
 * Family-facing booking history: one card per booking — CONFIRMED bookings and
 * bookings that were cancelled AFTER being paid for (never-paid ones are filtered
 * out in SQL, see my_booking_history). Shared by the student & parent history
 * pages. Purely presentational (server component).
 */
export function BookingHistory({ rows }: { rows: BookingHistoryRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border py-16 text-center">
        <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
          <Ticket className="size-6" />
        </span>
        <p className="font-semibold">No bookings yet</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          Once a seat is booked and paid for, it shows up here — along with any
          booking you cancelled after paying.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {rows.map((b) => {
        const cancelled = b.status === 'CANCELLED';
        const refundLabel = cancelled ? REFUND_LABEL[b.refund_status] : null;
        return (
          <Card key={b.booking_id}>
            <CardContent className="space-y-3 py-5">
              {/* Status + date */}
              <div className="flex items-center gap-3">
                <span
                  className={`grid size-11 shrink-0 place-items-center rounded-xl ${
                    cancelled ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success'
                  }`}
                >
                  {cancelled ? <XCircle className="size-5" /> : <CheckCircle2 className="size-5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                        cancelled
                          ? 'border border-destructive/30 bg-destructive/10 text-destructive'
                          : 'border border-success/30 bg-success/10 text-success'
                      }`}
                    >
                      {cancelled ? 'Cancelled' : 'Confirmed'}
                    </span>
                    {refundLabel && (
                      <span className="inline-flex items-center rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {refundLabel}
                      </span>
                    )}
                  </div>
                  <p className="tnum mt-0.5 text-sm text-muted-foreground">
                    {formatDateMedium(b.changed_at)}
                  </p>
                </div>
              </div>

              {/* Route → college */}
              <p className="text-sm font-medium">
                {b.route_name ?? 'Route'}
                {b.college_name ? <span className="text-muted-foreground"> → {b.college_name}</span> : null}
              </p>
              {(b.student_name || b.agency_name) && (
                <p className="-mt-2 text-xs text-muted-foreground">
                  {[b.student_name, b.agency_name].filter(Boolean).join(' · ')}
                </p>
              )}

              {/* Bus + pickup + amount */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {b.bus_number && (
                  <span className="inline-flex items-center gap-1.5">
                    <Bus className="size-3.5 shrink-0" /> Bus {b.bus_number}
                  </span>
                )}
                {b.pickup_name && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="size-3.5 shrink-0" /> {b.pickup_name}
                  </span>
                )}
                {b.amount_cents > 0 && (
                  <span className="inline-flex items-center gap-1 text-foreground">
                    <IndianRupee className="size-3.5 shrink-0" />
                    <span className="tnum font-semibold">{rupees(b.amount_cents).replace('₹', '')}</span>
                    {b.billing_period && (
                      <span className="font-normal text-muted-foreground">
                        · {periodLabel(b.billing_period as BillingPeriod)}
                      </span>
                    )}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
