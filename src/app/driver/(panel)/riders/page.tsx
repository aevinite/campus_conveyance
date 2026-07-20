import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { listDriverBookings, countDriverBookings } from '@/features/driver/repository';
import { DataTable } from '@/components/data-table';
import { Pager, pageParams } from '@/components/pager';
import { RideStageControl } from './ride-stage-control';

const LABEL: Record<string, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
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
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">My Riders</h1>
        <p className="text-muted-foreground">
          Tap a stage as the trip goes — the student and their parents get an
          instant update when they board, reach campus, and get off.
        </p>
      </div>

      <DataTable
        headers={['Student', 'Phone', 'Pickup stop', 'Route', 'Bus', 'Booking', 'Journey']}
        rows={bookings.map((b) => [
          b.student_name ?? '—',
          b.student_phone ?? '—',
          b.pickup_name ?? '—',
          b.route_name ? `${b.route_name} → ${b.college_name ?? 'campus'}` : '—',
          b.bus_number ? `Bus ${b.bus_number}` : '—',
          LABEL[b.status] ?? b.status,
          <RideStageControl
            key={b.booking_id}
            bookingId={b.booking_id}
            studentName={b.student_name ?? ''}
            currentStage={b.current_stage}
          />,
        ])}
        empty="No riders booked yet."
      />
      <Pager page={page} totalPages={totalPages} basePath="/driver/riders" />
    </section>
  );
}
