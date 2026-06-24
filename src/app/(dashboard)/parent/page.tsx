import { requireRole } from '@/features/auth/guard';

export default async function ParentDashboard() {
  await requireRole('PARENT');
  return (
    <section>
      <h1 className="text-2xl font-semibold">Parent Dashboard</h1>
      <p className="text-muted-foreground">
        Track your children, view attendance and receive alerts — coming in the
        next slices.
      </p>
    </section>
  );
}
