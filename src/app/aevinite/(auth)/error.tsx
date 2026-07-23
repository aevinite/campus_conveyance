'use client';

// Error boundary for the admin (aevinite) auth screens — keeps a role-correct
// "back" link instead of the root boundary's "/" home.
import { RouteError } from '@/components/route-error';

export default function AdminAuthError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      homeHref="/aevinite/login"
      homeLabel="Back to sign in"
      logLabel="Admin auth error:"
    />
  );
}
