import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Campus Conveyance brandmark — a bold bus-yellow tile with a dark route ring
 * tracing a loop and a warm "you are here" marker pinned at its centre. The
 * yellow livery reads instantly as student transport; dark strokes keep strong
 * contrast on the bright tile. Rendered as inline SVG so it stays crisp at any
 * size and reads the same in light and dark via brand tokens.
 */
export function BrandMark({ className }: { className?: string }) {
  const id = 'cc-brand-grad';
  return (
    <svg
      viewBox="0 0 40 40"
      className={cn('shrink-0', className)}
      role="img"
      aria-label="Campus Conveyance"
    >
      <defs>
        <linearGradient id={id} x1="4" y1="6" x2="36" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--brand-honey)" />
          <stop offset="0.5" stopColor="var(--brand-yellow)" />
          <stop offset="1" stopColor="var(--brand-gold)" />
        </linearGradient>
      </defs>
      {/* Rounded bus-yellow tile backdrop */}
      <rect x="2" y="2" width="36" height="36" rx="11" fill={`url(#${id})`} />
      {/* Open route ring (gap on the lower-right) — dark ink for contrast */}
      <path
        d="M 27.9 12.9 A 9.6 9.6 0 1 0 29 25.2"
        fill="none"
        stroke="#3a2a06"
        strokeOpacity="0.9"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      {/* "You are here" marker at centre */}
      <circle cx="20" cy="20" r="3.6" fill="#3a2a06" stroke="var(--brand-honey)" strokeWidth="1.6" />
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
      <BrandMark className="size-9 shadow-sm transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105 rounded-[11px]" />
      {showText && (
        <span className="flex flex-col leading-none">
          <span className="font-heading text-[17px] font-bold tracking-tight text-foreground">
            Campus
          </span>
          <span className="font-heading text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[color:var(--brand-amber-deep)]">
            Conveyance
          </span>
        </span>
      )}
    </Link>
  );
}
