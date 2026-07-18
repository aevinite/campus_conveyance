'use client';

// Route-level error boundary. Without this, ANY error thrown by a server action
// or a page/data fetch below the root layout showed Next.js's raw, unstyled
// "Application error" screen. This catches those, keeps the app chrome, and lets
// the user retry (reset() re-renders the failed segment) or head home.
import { useEffect } from 'react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface it for logs/monitoring; the digest ties the client error to the
    // server-side stack trace Next records.
    console.error('Route error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md space-y-4 rounded-2xl border border-border bg-card/60 p-8">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          An unexpected error occurred. You can try again, and if it keeps
          happening please contact support.
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground">
            Reference: <span className="font-mono">{error.digest}</span>
          </p>
        )}
        <div className="flex justify-center gap-2.5 pt-1">
          <button onClick={reset} className={buttonVariants()}>
            Try again
          </button>
          <Link href="/" className={buttonVariants({ variant: 'outline' })}>
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
