import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface StatItem {
  /** Small uppercase caption above the figure. */
  label: string;
  /** The headline figure (already formatted). */
  value: React.ReactNode;
  /** Optional secondary line under the figure. */
  sub?: React.ReactNode;
  /** If set, the whole cell becomes a link. */
  href?: string;
}

/**
 * A single bordered container split into evenly-divided stat cells — the
 * headline strip from the reference. Cells stack two-up on small screens and
 * divide horizontally from `sm` up. `cols` controls the wide-screen column count.
 */
export function StatStrip({
  items,
  cols = 4,
  className,
}: {
  items: StatItem[];
  cols?: 3 | 4;
  className?: string;
}) {
  const wide = cols === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-4';
  return (
    <div
      className={cn(
        'grid grid-cols-2 divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-xs',
        wide,
        'sm:divide-x',
        className,
      )}
    >
      {items.map((s, i) => {
        const body = (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {s.label}
            </p>
            <p className="tnum mt-1.5 text-2xl font-bold tracking-tight sm:text-3xl">{s.value}</p>
            {s.sub && <p className="mt-0.5 truncate text-xs text-muted-foreground">{s.sub}</p>}
          </>
        );
        const cellClass = cn(
          'px-5 py-5',
          // Row dividers for the 2-col mobile layout; sm:divide-x handles wide.
          i >= 2 && 'border-t sm:border-t-0',
          i % 2 === 1 && 'border-l sm:border-l-0',
        );
        return s.href ? (
          <Link
            key={s.label}
            href={s.href}
            className={cn(cellClass, 'transition-colors hover:bg-secondary/40')}
          >
            {body}
          </Link>
        ) : (
          <div key={s.label} className={cellClass}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
