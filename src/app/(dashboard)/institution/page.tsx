import { Building2 } from 'lucide-react';
import { requireRole } from '@/features/auth/guard';
import { ComingSoon } from '@/components/coming-soon';

export default async function InstitutionDashboard() {
  // Institution admins sign in via the admin (aevinite) login — match that here
  // so a not-signed-in hit isn't bounced to the student /login.
  await requireRole('INSTITUTION_ADMIN', '/aevinite/login');
  return (
    <ComingSoon
      icon={Building2}
      title="Institution Dashboard"
      description="Run your campus transport end to end. Manage routes, vehicles, drivers, students, bookings, and payments — all in one place."
      items={['Routes & vehicles', 'Drivers & students', 'Bookings overview', 'Payments & reports']}
    />
  );
}
