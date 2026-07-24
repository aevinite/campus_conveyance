'use client';
import { useState } from 'react';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Read-only star display. Supports fractional values (e.g. a 4.3 aggregate) by
 * clipping a gold star row over a muted row. Purely presentational.
 */
export function StarRating({
  value,
  count,
  size = 16,
  className,
}: {
  value: number;
  count?: number | null;
  size?: number;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  const stars = (fill: boolean) =>
    Array.from({ length: 5 }, (_, i) => (
      <Star
        key={i}
        style={{ width: size, height: size }}
        className={fill ? 'fill-amber-400 text-amber-400' : 'fill-muted text-muted'}
        strokeWidth={1.5}
      />
    ));
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className="relative inline-flex" aria-hidden>
        <span className="inline-flex">{stars(false)}</span>
        <span
          className="pointer-events-none absolute inset-0 inline-flex overflow-hidden"
          style={{ width: `${pct}%` }}
        >
          {stars(true)}
        </span>
      </span>
      {count != null && (
        <span className="tnum text-xs text-muted-foreground">
          {value > 0 ? value.toFixed(1) : '—'}
          {count > 0 && ` (${count})`}
        </span>
      )}
    </span>
  );
}

/**
 * Interactive 1–5 star picker. Controlled: parent holds `value` and gets updates
 * via `onChange`. Keyboard-accessible (each star is a button).
 */
export function StarRatingInput({
  value,
  onChange,
  size = 28,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  size?: number;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <span className="inline-flex items-center gap-1" role="radiogroup" aria-label="Star rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          disabled={disabled}
          onClick={() => onChange(n)}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          className="rounded-md p-0.5 transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
        >
          <Star
            style={{ width: size, height: size }}
            className={
              n <= shown ? 'fill-amber-400 text-amber-400' : 'fill-muted text-muted-foreground/40'
            }
            strokeWidth={1.5}
          />
        </button>
      ))}
    </span>
  );
}
