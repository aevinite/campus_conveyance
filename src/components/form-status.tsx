import { cn } from '@/lib/utils';

/**
 * Consistent inline status banners for server-action forms. Uses theme tokens
 * so success/error read correctly in both light and dark.
 */
export function FormStatus({
  error,
  message,
  className,
}: {
  error?: string;
  message?: string;
  className?: string;
}) {
  if (!error && !message) return null;
  return (
    <div className={cn('space-y-2', className)}>
      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          {message}
        </p>
      )}
    </div>
  );
}
