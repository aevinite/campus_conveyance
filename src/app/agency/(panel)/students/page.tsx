import { createClient } from '@/lib/supabase/server';
import { getMyAgency, listMyBookings, listMyStudents } from '@/features/agency/repository';
import { expireStaleHolds } from '@/features/booking/repository';
import { hideStudentAction } from '@/features/agency/actions';
import { SubmitButton } from '@/components/submit-button';
import { BookingCard } from '../booking-card';

export default async function AgencyStudentsPage() {
  const db = await createClient();
  await expireStaleHolds(db); // sweep lapsed holds so counts/roster are honest
  const agency = await getMyAgency(db);
  const [bookings, students] = agency
    ? await Promise.all([listMyBookings(db, agency.id), listMyStudents(db, agency.id)])
    : [[], []];

  // Only students you have accepted onto a bus (CONFIRMED). A student's details
  // are NOT shown here until you confirm the booking — pending requests live in
  // Manage Booking, where you review the details and accept/reject. Hidden
  // (deleted) students are excluded and shown under Deleted Students.
  const hidden = new Set(students.filter((s) => s.hidden).map((s) => s.student_id));
  const onboard = bookings.filter(
    (b) => b.status === 'CONFIRMED' && b.student_id && !hidden.has(b.student_id),
  );

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Manage Students</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Students you have accepted onto a bus, with every detail they entered while booking. New
          requests appear under <span className="font-medium text-foreground">Manage Booking</span> —
          a student only shows here once you confirm their booking.
        </p>
      </div>

      {onboard.length === 0 ? (
        <p className="rounded-lg border border-border bg-card/40 p-6 text-sm text-muted-foreground">
          No students onboard yet. Accept a paid booking request in Manage Booking and the student will
          appear here.
        </p>
      ) : (
        <div className="space-y-4">
          {onboard.map((b) => (
            <BookingCard
              key={b.booking_id}
              b={b}
              action={
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span className="rounded-full border border-success/40 bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success">
                    Onboard
                  </span>
                  {b.student_id ? (
                    <form action={hideStudentAction}>
                      <input type="hidden" name="studentId" value={b.student_id} />
                      <SubmitButton variant="destructive" size="sm" pendingText="Removing…">
                        Remove
                      </SubmitButton>
                    </form>
                  ) : null}
                </div>
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}
