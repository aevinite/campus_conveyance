'use client';

// Error boundary for the driver auth screens — keeps a role-correct "back" link
// instead of the root boundary's "/" home.
import { RouteError } from '@/components/route-error';

export default function DriverAuthError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      homeHref="/driver/login"
      homeLabel="Back to sign in"
      logLabel="Driver auth error:"
    />
  );
}
