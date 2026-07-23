import { Loader2 } from 'lucide-react';

/** Top-level navigation fallback while a route's server component streams in. */
export default function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground">
      <Loader2 className="size-6 animate-spin" />
    </div>
  );
}
