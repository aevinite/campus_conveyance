import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import type { BookingRow } from '@/features/agency/repository';
import { formatDateTime } from '@/lib/format-date';

const inr = (c: number | null) =>
  c == null
    ? '—'
    : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
        c / 100,
      );
const fmt = (v: string) => formatDateTime(v);

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm">{value || '—'}</p>
    </div>
  );
}

/** One booking with every detail the student entered + which bus/route they chose. */
export function BookingCard({ b, action }: { b: BookingRow; action?: ReactNode }) {
  return (
    <Card className="rounded-2xl transition-colors hover:border-primary/30">
      <CardContent className="space-y-4 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-base font-semibold">{b.student_name || '—'}</p>
              <span
                className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                  b.is_paid
                    ? 'border-success/40 bg-success/10 text-success'
                    : 'border-warning/40 bg-warning/10 text-warning'
                }`}
              >
                {b.is_paid ? 'Paid' : 'Payment pending'}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {[b.student_email, b.student_phone].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
          {action}
        </div>

        <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Bus" value={b.bus_number ? `Bus ${b.bus_number}` : '—'} />
          <Detail label="Registration" value={b.bus_registration} />
          <Detail label="Route" value={b.route_name} />
          <Detail label="Pickup stop" value={b.pickup_name} />
          <Detail label="Drop-off (campus)" value={b.drop_name} />
          <Detail label="Fare" value={inr(b.price_cents)} />
          <Detail label="Class / Grade" value={b.student_grade} />
          <Detail label="Guardian" value={b.guardian_name} />
          <Detail label="Guardian phone" value={b.guardian_phone} />
          <Detail label="Address" value={b.student_address} />
          <Detail label="Booked on" value={fmt(b.created_at)} />
        </div>
      </CardContent>
    </Card>
  );
}
