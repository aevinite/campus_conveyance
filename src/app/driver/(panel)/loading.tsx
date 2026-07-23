import { Loader2 } from 'lucide-react';

/**
 * Navigation feedback for the driver panel: shown via React Suspense while the
 * next driver page streams in, so a slow page shows a spinner rather than a
 * blank shell.
 */
export default function Loading() {
  return (
    <div className="flex items-center justify-center py-24 text-primary">
      <Loader2 className="size-6 animate-spin" />
    </div>
  );
}
