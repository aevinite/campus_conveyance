'use client';

// Error boundary for the auth screens (login/register/forgot/reset/verify).
import { RouteError } from '@/components/route-error';

export default function AuthError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      homeHref="/login"
      homeLabel="Back to sign in"
      logLabel="Auth error:"
    />
  );
}
