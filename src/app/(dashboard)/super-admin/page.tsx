import { requireRole } from '@/features/auth/guard';

export default async function SuperAdminDashboard() {
  await requireRole('SUPER_ADMIN');
  return (
    <section>
      <h1 className="text-2xl font-semibold">Super Admin Dashboard</h1>
      <p className="text-muted-foreground">
        Manage institutions, subscriptions, platform revenue and global settings
        — coming in the next slices.
      </p>
    </section>
  );
}
