'use client';

// Admin-panel error boundary. It sits inside the (panel) layout, so a failing
// admin action/fetch keeps the sidebar and offers "Back to dashboard" (/aevinite)
// instead of falling to the root error.tsx, whose "Go home" points at "/".
import { useEffect } from 'react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export default function AdminPanelError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Admin panel error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md space-y-4 rounded-2xl border border-border bg-card/60 p-8">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          That admin action couldn&apos;t be completed. You can try again or head
          back to the dashboard.
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
          <Link href="/aevinite" className={buttonVariants({ variant: 'outline' })}>
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
