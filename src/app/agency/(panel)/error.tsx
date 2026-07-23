'use client';

// Error boundary for the agency panel — keeps the agency sidebar/shell.
import { RouteError } from '@/components/route-error';

export default function AgencyPanelError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      homeHref="/agency"
      homeLabel="Back to dashboard"
      logLabel="Agency panel error:"
    />
  );
}
