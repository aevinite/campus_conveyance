'use client';

// Shared body for the per-segment error.tsx boundaries. Each route group wraps
// this with a `home` link that points at that group's own landing page, so a
// thrown error keeps the app chrome and offers a sensible "go back" instead of
// dropping to the root boundary (whose "Go home" points at "/").
import { useEffect } from 'react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export function RouteError({
  error,
  reset,
  homeHref,
  homeLabel,
  message = 'An unexpected error occurred. You can try again, and if it keeps happening please contact support.',
  logLabel = 'Route error:',
}: {
  error: Error & { digest?: string };
  reset: () => void;
  homeHref: string;
  homeLabel: string;
  message?: string;
  logLabel?: string;
}) {
  useEffect(() => {
    // Surface for logs/monitoring; the digest ties this to the server stack trace.
    console.error(logLabel, error);
    // A ChunkLoadError almost always means the deployed build changed (new chunk
    // hashes) while this tab still held the old document — a common symptom right
    // after a redeploy. Fetching the page fresh pulls the new chunks and recovers,
    // so reload automatically instead of stranding the user on this screen. Guard
    // with a timestamp so a genuinely-missing chunk can't loop: we only auto-reload
    // if we haven't already done so in the last 10s.
    if (typeof window === 'undefined') return;
    const isChunkError =
      error?.name === 'ChunkLoadError' ||
      /loading chunk [\w-]+ failed|chunkloaderror|importing a module script failed/i.test(
        error?.message ?? '',
      );
    if (!isChunkError) return;
    const KEY = 'cc-chunk-reload-at';
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last > 10_000) {
      sessionStorage.setItem(KEY, String(Date.now()));
      window.location.reload();
    }
  }, [error, logLabel]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md space-y-4 rounded-2xl border border-border bg-card/60 p-8">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        {error.digest && (
          <p className="text-xs text-muted-foreground">
            Reference: <span className="font-mono">{error.digest}</span>
          </p>
        )}
        <div className="flex justify-center gap-2.5 pt-1">
          <button onClick={reset} className={buttonVariants()}>
            Try again
          </button>
          <Link href={homeHref} className={buttonVariants({ variant: 'outline' })}>
            {homeLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}
