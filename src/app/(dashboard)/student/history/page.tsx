import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { listMyBookingHistory } from '@/features/history/repository';
import { BookingHistory } from '@/components/booking-history';

export default async function StudentHistoryPage() {
  await requireRole('STUDENT');
  const db = await createClient();
  const rows = await listMyBookingHistory(db);

  return (
    <section className="max-w-2xl space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">Your bookings</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Booking History</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your confirmed bookings, plus any you cancelled after paying — newest first.
        </p>
      </div>
      <BookingHistory rows={rows} />
    </section>
  );
}
