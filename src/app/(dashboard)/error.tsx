'use client';

// Error boundary for the student/parent/institution dashboards. Keeps the
// dashboard shell instead of falling to the root boundary.
import { RouteError } from '@/components/route-error';

export default function DashboardError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      homeHref="/"
      homeLabel="Back to dashboard"
      logLabel="Dashboard error:"
    />
  );
}
