import { Building2 } from 'lucide-react';
import { requireRole } from '@/features/auth/guard';
import { ComingSoon } from '@/components/coming-soon';

export default async function InstitutionDashboard() {
  await requireRole('INSTITUTION_ADMIN');
  return (
    <ComingSoon
      icon={Building2}
      title="Institution Dashboard"
      description="Run your campus transport end to end. Manage routes, vehicles, drivers, students, bookings, and payments — all in one place."
      items={['Routes & vehicles', 'Drivers & students', 'Bookings overview', 'Payments & reports']}
    />
  );
}
