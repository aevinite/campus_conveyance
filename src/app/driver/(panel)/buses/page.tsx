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
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">My Buses</h1>
        <p className="text-muted-foreground">The buses and routes your agency has assigned to you.</p>
      </div>

      {buses.length === 0 ? (
        <p className="rounded-lg border border-border bg-card/40 p-6 text-sm text-muted-foreground">
          No bus assigned to you yet.
        </p>
      ) : (
        <div className="space-y-4">
          {buses.map((b) => (
            <Card key={b.vehicle_id}>
              <CardContent className="flex flex-wrap gap-4 py-5">
                {b.image_url ? (
                  <Image
                    src={b.image_url}
                    alt={b.bus_number ? `Bus ${b.bus_number}` : 'Bus'}
                    width={200}
                    height={130}
                    unoptimized
                    className="h-32 w-48 shrink-0 rounded-xl border border-border object-cover"
                  />
                ) : (
                  <div className="grid h-32 w-48 shrink-0 place-items-center rounded-xl border border-border bg-muted/40 text-muted-foreground">
                    <Bus className="size-10" />
                  </div>
                )}

                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-semibold">
                      {b.bus_number ? `Bus ${b.bus_number}` : 'Bus'}
                    </span>
                    <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {b.is_ac ? 'AC' : 'Non-AC'}
                    </span>
                    {b.registration_no && (
                      <span className="text-sm text-muted-foreground">{b.registration_no}</span>
                    )}
                  </div>

                  {b.route_name ? (
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="size-3.5" /> {b.route_name} → {b.college_name ?? 'campus'}
                      </span>
                      {b.departure_time && (
                        <span className="inline-flex items-center gap-1.5">
                          <Clock className="size-3.5" /> {b.departure_time.slice(0, 5)}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="size-3.5" /> {b.stops_count} pickup stop{b.stops_count === 1 ? '' : 's'}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <IndianRupee className="size-3.5" /> {rupees(b.price_cents)}
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No route set up on this bus yet.</p>
                  )}

                  <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Users className="size-3.5" />
                    {b.seats_reserved ?? 0} of {b.seats_total ?? b.capacity} seats booked
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
