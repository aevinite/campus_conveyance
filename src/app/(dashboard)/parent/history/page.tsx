import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { listMyBookingHistory } from '@/features/history/repository';
import { BookingHistory } from '@/components/booking-history';

export default async function ParentHistoryPage() {
  await requireRole('PARENT');
  const db = await createClient();
  const rows = await listMyBookingHistory(db);

  return (
    <section className="max-w-2xl space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          Your children&apos;s bookings
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Booking History</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your children&apos;s confirmed bookings, plus any cancelled after paying — newest first.
        </p>
      </div>
      <BookingHistory rows={rows} />
    </section>
  );
}
