import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Campus Conveyance brandmark — an open amber ring with a route motif inside
 * (pale stops flanking a blue "you are here" dot). Rendered as inline SVG so it
 * stays crisp at any size; the ring/dot use fixed brand colors while the "G"
 * opening reads the same in light and dark.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={cn('shrink-0', className)}
      role="img"
      aria-label="Campus Conveyance"
    >
      {/* Open ring (gap on the right) */}
      <path
        d="M 29.19 10.81 A 13 13 0 1 0 29.19 29.19"
        fill="none"
        stroke="var(--brand-amber)"
        strokeWidth="5.4"
        strokeLinecap="round"
      />
      {/* Inward tab at the top of the opening — the "G" cue */}
      <path
        d="M 28.4 10.9 L 23.2 10.9"
        fill="none"
        stroke="var(--brand-amber)"
        strokeWidth="5.4"
        strokeLinecap="round"
      />
      {/* Route: pale stop · blue marker · pale stop */}
      <rect x="8.6" y="18.4" width="5" height="3.2" rx="1.6" fill="var(--brand-pale)" />
      <circle cx="20" cy="20" r="2.9" fill="var(--brand-blue)" />
      <rect x="24.4" y="18.4" width="5" height="3.2" rx="1.6" fill="var(--brand-pale)" />
    </svg>
  );
}

export function Logo({
  className,
  href = '/',
  showText = true,
}: {
  className?: string;
  href?: string;
  showText?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn('group flex items-center gap-2.5', className)}
      aria-label="Campus Conveyance"
    >
      <BrandMark className="size-9 transition-transform group-hover:-rotate-6" />
      {showText && (
        <span className="flex flex-col leading-none">
          <span className="font-heading text-[17px] font-extrabold tracking-tight text-foreground">
            Campus
          </span>
          <span className="font-heading text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[color:var(--brand-amber-deep)]">
            Conveyance
          </span>
        </span>
      )}
    </Link>
  );
}
