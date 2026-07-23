import Image from 'next/image';
import { Bus, Clock, IndianRupee, MapPin, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { listDriverBuses } from '@/features/driver/repository';
import { Card, CardContent } from '@/components/ui/card';

const rupees = (c: number | null) => (c == null ? '—' : `₹${Math.round(c / 100)}`);

export default async function DriverBusesPage() {
  const db = await createClient();
  const buses = await listDriverBuses(db);

  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <p className="text-xs font-semibold tracking-wider text-primary uppercase">Fleet</p>
        <h1 className="text-2xl font-heading font-bold tracking-tight sm:text-3xl">My Buses</h1>
        <p className="text-muted-foreground">The buses and routes your agency has assigned to you.</p>
      </div>

      {buses.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <Bus className="size-6" />
            </span>
            <p className="text-sm text-muted-foreground">No bus assigned to you yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {buses.map((b) => {
            const seatsTotal = b.seats_total ?? b.capacity;
            const seatsReserved = b.seats_reserved ?? 0;
            const pct = seatsTotal ? Math.min(100, Math.round((seatsReserved / seatsTotal) * 100)) : 0;
            return (
              <Card key={`${b.vehicle_id}:${b.route_id ?? 'none'}`} className="overflow-hidden">
                <CardContent className="flex flex-col gap-4 py-5 sm:flex-row">
                  {b.image_url ? (
                    <Image
                      src={b.image_url}
                      alt={b.bus_number ? `Bus ${b.bus_number}` : 'Bus'}
                      width={200}
                      height={130}
                      unoptimized
                      className="h-40 w-full shrink-0 rounded-2xl border border-border object-cover sm:h-32 sm:w-48"
                    />
                  ) : (
                    <div className="grid h-40 w-full shrink-0 place-items-center rounded-2xl border border-border bg-muted/40 text-muted-foreground sm:h-32 sm:w-48">
                      <Bus className="size-10" />
                    </div>
                  )}

                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-heading text-lg font-semibold">
                        {b.bus_number ? `Bus ${b.bus_number}` : 'Bus'}
                      </span>
                      <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                        {b.is_ac ? 'AC' : 'Non-AC'}
                      </span>
                      {b.registration_no && (
                        <span className="text-sm text-muted-foreground">{b.registration_no}</span>
                      )}
                    </div>

                    {b.route_name ? (
                      <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin className="size-3.5 shrink-0 text-primary" /> {b.route_name} → {b.college_name ?? 'campus'}
                        </span>
                        {b.departure_time && (
                          <span className="inline-flex items-center gap-1.5">
                            <Clock className="size-3.5 shrink-0" /> {b.departure_time.slice(0, 5)}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin className="size-3.5 shrink-0" /> {b.stops_count} pickup stop{b.stops_count === 1 ? '' : 's'}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <IndianRupee className="size-3.5 shrink-0" /> {rupees(b.price_cents)}
                        </span>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No route set up on this bus yet.</p>
                    )}

                    <div className="space-y-1.5">
                      <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Users className="size-3.5 shrink-0" />
                        <span className="tnum font-medium text-foreground">{seatsReserved}</span>
                        of <span className="tnum font-medium text-foreground">{seatsTotal}</span> seats booked
                      </p>
                      <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
