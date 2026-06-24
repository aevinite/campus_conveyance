import { requireRole } from '@/features/auth/guard';

export default async function StudentDashboard() {
  await requireRole('STUDENT');
  return (
    <section>
      <h1 className="text-2xl font-semibold">Student Dashboard</h1>
      <p className="text-muted-foreground">
        Bookings, attendance and live tracking arrive in the next slices.
      </p>
    </section>
  );
}
