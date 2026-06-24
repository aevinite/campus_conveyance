import Link from 'next/link';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { listMyBookings } from '@/features/booking/repository';
import { cancelBookingAction } from '@/features/booking/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const STATUS_STYLES: Record<string, string> = {
  CONFIRMED: 'text-green-600',
  WAITLISTED: 'text-amber-600',
  CANCELLED: 'text-muted-foreground line-through',
  PENDING: 'text-blue-600',
};

export default async function BookingsPage() {
  await requireRole('STUDENT');
  const db = await createClient();
  const bookings = await listMyBookings(db);

  return (
    <section className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My Bookings</h1>
        <Link href="/student/routes" className="text-sm underline">
          Book a seat
        </Link>
      </div>
      {bookings.length === 0 ? (
        <p className="text-muted-foreground">You have no bookings yet.</p>
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => (
            <Card key={b.id}>
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <p className="font-medium">{b.routeName}</p>
                  <p className={`text-sm ${STATUS_STYLES[b.status] ?? ''}`}>
                    {b.status}
                  </p>
                </div>
                {b.status !== 'CANCELLED' && (
                  <form action={cancelBookingAction}>
                    <input type="hidden" name="bookingId" value={b.id} />
                    <Button type="submit" variant="outline" size="sm">
                      Cancel
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
