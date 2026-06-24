import { requireRole } from '@/features/auth/guard';

export default async function InstitutionDashboard() {
  await requireRole('INSTITUTION_ADMIN');
  return (
    <section>
      <h1 className="text-2xl font-semibold">Institution Dashboard</h1>
      <p className="text-muted-foreground">
        Manage routes, vehicles, drivers, students, bookings and payments —
        coming in the next slices.
      </p>
    </section>
  );
}
