import { redirect } from 'next/navigation';
import { Users } from 'lucide-react';
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
        <span className="text-xs font-semibold uppercase tracking-widest text-primary">Students</span>
        <h1 className="mt-1 text-2xl font-heading font-bold tracking-tight sm:text-3xl">Manage students</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Students you have accepted onto a bus, with every detail they entered while booking. New
          requests appear under <span className="font-medium text-foreground">Manage Booking</span> —
          a student only shows here once you confirm their booking.
        </p>
      </div>

      {onboard.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card/40 p-10 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Users className="size-6" />
          </span>
          <div>
            <p className="font-medium">No students onboard yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Accept a paid booking request in Manage Booking and the student will appear here.
            </p>
          </div>
        </div>
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
