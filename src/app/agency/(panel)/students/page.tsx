import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMyAgency, listOnboardBookings, countOnboardBookings } from '@/features/agency/repository';
import { hideStudentAction } from '@/features/agency/actions';
import { SubmitButton } from '@/components/submit-button';
import { BookingCard } from '../booking-card';
import { Pager, pageParams } from '@/components/pager';

const PAGE_SIZE = 20;

export default async function AgencyStudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, PAGE_SIZE);
  const db = await createClient();
  const agency = await getMyAgency(db);
  // CONFIRMED + not-hidden, paginated and counted in the DB (migration 0059) so
  // the list, the page fill, and the pager total all agree — hidden (removed)
  // students, shown under Deleted Students, never consume limit/offset slots or
  // pad "Page X of Y".
  const [onboard, total] = agency
    ? await Promise.all([
        listOnboardBookings(db, agency.id, { limit: PAGE_SIZE, offset }),
        countOnboardBookings(db, agency.id),
      ])
    : [[], 0];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/agency/students?page=${totalPages}`);

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
          <Pager page={page} totalPages={totalPages} basePath="/agency/students" />
        </div>
      )}
    </section>
  );
}
