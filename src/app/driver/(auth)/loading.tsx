import { Loader2 } from 'lucide-react';

/** Navigation feedback for the driver auth screens while the page streams in. */
export default function Loading() {
  return (
    <div className="flex items-center justify-center py-24 text-muted-foreground">
      <Loader2 className="size-6 animate-spin" />
    </div>
  );
}
