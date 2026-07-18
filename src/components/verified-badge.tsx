import { BadgeCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Green "verified" tick shown beside a verified institution's name. Renders
 * nothing when the institution isn't verified.
 */
export function VerifiedBadge({
  verified,
  className,
  withLabel = false,
}: {
  verified: boolean;
  className?: string;
  withLabel?: boolean;
}) {
  if (!verified) return null;
  return (
    <span
      title="Verified institution"
      className={cn('inline-flex items-center gap-1 text-success align-middle', className)}
    >
      <BadgeCheck className="size-[1.1em] fill-success/15" aria-label="Verified" />
      {withLabel && <span className="text-xs font-medium">Verified</span>}
    </span>
  );
}
