import { createClient } from '@/lib/supabase/server';
import { listDriverBookings } from '@/features/driver/repository';
import { DataTable } from '@/components/data-table';

const LABEL: Record<string, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
};

export default async function DriverRidersPage() {
  const db = await createClient();
  const bookings = await listDriverBookings(db);

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">My Riders</h1>
        <p className="text-muted-foreground">
          Students booked on your bus — who to pick up and from where.
        </p>
      </div>

      <DataTable
        headers={['Student', 'Phone', 'Pickup stop', 'Route', 'Bus', 'Status']}
        rows={bookings.map((b) => [
          b.student_name ?? '—',
          b.student_phone ?? '—',
          b.pickup_name ?? '—',
          b.route_name ? `${b.route_name} → ${b.college_name ?? 'campus'}` : '—',
          b.bus_number ? `Bus ${b.bus_number}` : '—',
          LABEL[b.status] ?? b.status,
        ])}
        empty="No riders booked yet."
      />
    </section>
  );
}
