import { Loader2 } from 'lucide-react';

/**
 * Instant navigation feedback: shown via React Suspense while the next route's
 * server component streams in, so clicking a link never looks frozen.
 */
export default function Loading() {
  return (
    <div className="flex items-center justify-center py-24 text-muted-foreground">
      <Loader2 className="size-6 animate-spin" />
    </div>
  );
}
