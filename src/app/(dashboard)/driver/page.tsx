import { requireRole } from '@/features/auth/guard';

export default async function DriverDashboard() {
  await requireRole('DRIVER');
  return (
    <section>
      <h1 className="text-2xl font-semibold">Driver Dashboard</h1>
      <p className="text-muted-foreground">
        Assigned routes, GPS sharing and attendance scanning arrive in the next
        slices.
      </p>
    </section>
  );
}
