'use client';

// Error boundary for the campus auth screens (login/register/forgot).
import { RouteError } from '@/components/route-error';

export default function InstitutionAuthError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      homeHref="/institution/login"
      homeLabel="Back to sign in"
      logLabel="Institution auth error:"
    />
  );
}
