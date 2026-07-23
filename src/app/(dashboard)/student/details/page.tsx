import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { getStudentDetails } from '@/features/booking/services';
import { DetailsForm } from './details-form';

/**
 * Standalone "your details" step. Booking normally collects these on the
 * agency page, but a student can deep-link straight to a route — the route
 * page sends them here first (?next=/student/routes/<id>) so a booking can
 * never be created with a blank address/guardian.
 */
export default async function StudentDetailsPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  await requireRole('STUDENT');
  const { next } = await searchParams;
  const db = await createClient();
  const details = await getStudentDetails(db);
  // Only bounce back inside the student area (never to an external URL).
  const safeNext = next?.startsWith('/student') ? next : '/student/schools';

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          Before you book
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Your details</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          We need these before you can reserve a seat — the agency uses them to
          confirm and manage your booking.
        </p>
      </div>
      <DetailsForm details={details} next={safeNext} />
    </section>
  );
}
