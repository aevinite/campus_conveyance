'use client';

// Error boundary for the driver panel — keeps the driver shell instead of
// dropping to a full-screen root error.
import { RouteError } from '@/components/route-error';

export default function DriverPanelError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      homeHref="/driver"
      homeLabel="Back to dashboard"
      logLabel="Driver panel error:"
    />
  );
}
