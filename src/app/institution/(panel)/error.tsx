'use client';

// Error boundary for the institution (campus) panel — keeps the panel shell.
import { RouteError } from '@/components/route-error';

export default function InstitutionPanelError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      homeHref="/institution"
      homeLabel="Back to dashboard"
      logLabel="Institution panel error:"
    />
  );
}
