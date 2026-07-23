import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Campus Conveyance brandmark — a bold gradient "signal" tile: an open
 * indigo→cyan ring tracing a route, with a signal-green "you are here" marker
 * pinned at its centre. Rendered as inline SVG so it stays crisp at any size;
 * the gradient + marker read the same in light and dark via brand tokens.
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
          <stop offset="0" stopColor="var(--brand-indigo)" />
          <stop offset="0.55" stopColor="var(--brand-glow)" />
          <stop offset="1" stopColor="var(--brand-cyan)" />
        </linearGradient>
      </defs>
      {/* Rounded tile backdrop */}
      <rect x="2" y="2" width="36" height="36" rx="11" fill={`url(#${id})`} />
      {/* Open route ring (gap on the lower-right), on the tile */}
      <path
        d="M 27.9 12.9 A 9.6 9.6 0 1 0 29 25.2"
        fill="none"
        stroke="white"
        strokeOpacity="0.92"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      {/* Signal-green "you are here" marker at centre */}
      <circle cx="20" cy="20" r="3.6" fill="var(--brand-green)" stroke="white" strokeWidth="1.6" />
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
          <span className="font-heading text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[color:var(--brand-indigo-deep)]">
            Conveyance
          </span>
        </span>
      )}
    </Link>
  );
}
