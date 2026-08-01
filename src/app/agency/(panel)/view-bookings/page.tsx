import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Eye } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getMyAgency, listMyBookings, countMyBookings } from '@/features/agency/repository';
import { BookingCard } from '../booking-card';
import { Pager } from '@/components/pager';
import { cn } from '@/lib/utils';

const FILTERS = ['ALL', 'CONFIRMED', 'PENDING', 'WAITLISTED', 'CANCELLED', 'REJECTED'] as const;

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
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const { page: pageParam, status: statusParam } = await searchParams;
  // Default to CONFIRMED (paid) — the agency usually wants its actual riders;
  // every status is still one click away via the chips ("All" shows everything).
  const status = FILTERS.includes((statusParam ?? 'CONFIRMED').toUpperCase() as (typeof FILTERS)[number])
    ? ((statusParam ?? 'CONFIRMED').toUpperCase() as string)
    : 'CONFIRMED';
  const statusArg = status === 'ALL' ? undefined : status;
  const page = Math.max(1, Number(pageParam) || 1);
  const db = await createClient();
  // Lapsed holds are swept by the pg_cron 'expire-stale-holds' job (migration 0052).
  const agency = await getMyAgency(db);
  // Paginate in the DB — the full booking history could be multi-MB at scale.
  const [bookings, total] = agency
    ? await Promise.all([
        listMyBookings(db, agency.id, { status: statusArg, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
        countMyBookings(db, agency.id, statusArg),
      ])
    : [[], 0];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/agency/view-bookings?page=${totalPages}&status=${status}`);

  return (
    <section className="space-y-4">
      <div>
        <span className="text-xs font-semibold uppercase tracking-widest text-primary">Bookings</span>
        <h1 className="mt-1 text-2xl font-heading font-bold tracking-tight sm:text-3xl">View booking</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every booking with the student&apos;s full details and the bus/route they chose
          ({total} {status === 'ALL' ? 'total' : status.toLowerCase()}).
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === 'CONFIRMED' ? '/agency/view-bookings' : `/agency/view-bookings?status=${f}`}
            aria-current={status === f ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-1 text-sm transition-colors',
              status === f ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border text-muted-foreground hover:bg-muted',
            )}
          >
            {f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
          </Link>
        ))}
      </div>

      {bookings.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card/40 p-10 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Eye className="size-6" />
          </span>
          <div>
            <p className="font-medium">No bookings yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Bookings placed with your services will appear here.</p>
          </div>
        </div>
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
