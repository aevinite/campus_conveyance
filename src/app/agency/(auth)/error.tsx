'use client';

// Error boundary for the agency auth screens (login/register/forgot).
import { RouteError } from '@/components/route-error';

export default function AgencyAuthError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      homeHref="/agency/login"
      homeLabel="Back to sign in"
      logLabel="Agency auth error:"
    />
  );
}
