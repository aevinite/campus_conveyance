import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMyAgency, listMyBookings, countMyBookings } from '@/features/agency/repository';
import { BookingCard } from '../booking-card';
import { Pager } from '@/components/pager';

const PAGE_SIZE = 20;

const STYLE: Record<string, string> = {
  PENDING: 'border-warning/40 bg-warning/10 text-warning',
  CONFIRMED: 'border-success/40 bg-success/10 text-success',
  CANCELLED: 'border-border bg-muted text-muted-foreground',
  REJECTED: 'border-destructive/40 bg-destructive/10 text-destructive',
  WAITLISTED: 'border-primary/40 bg-primary/10 text-primary',
};
const LABEL: Record<string, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled by student',
  REJECTED: 'Rejected',
  WAITLISTED: 'Waitlisted',
};

export default async function AgencyViewBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const db = await createClient();
  // Lapsed holds are swept by the pg_cron 'expire-stale-holds' job (migration 0052).
  const agency = await getMyAgency(db);
  // Paginate in the DB — the full booking history could be multi-MB at scale.
  const [bookings, total] = agency
    ? await Promise.all([
        listMyBookings(db, agency.id, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
        countMyBookings(db, agency.id),
      ])
    : [[], 0];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/agency/view-bookings?page=${totalPages}`);

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">View Booking</h1>
      <p className="text-sm text-muted-foreground">
        Every booking with the student&apos;s full details and the bus/route they chose.
      </p>

      {bookings.length === 0 ? (
        <p className="rounded-lg border border-border bg-card/40 p-6 text-sm text-muted-foreground">
          No bookings yet.
        </p>
      ) : (
        <div className="space-y-4">
          {bookings.map((b) => (
            <BookingCard
              key={b.booking_id}
              b={b}
              action={
                <span
                  className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                    STYLE[b.status] ?? 'border-border text-muted-foreground'
                  }`}
                >
                  {LABEL[b.status] ?? b.status}
                </span>
              }
            />
          ))}
          <Pager page={page} totalPages={totalPages} basePath="/agency/view-bookings" />
        </div>
      )}
    </section>
  );
}
