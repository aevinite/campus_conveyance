// Dependency-free horizontal bar chart. Server-renderable (no hooks): marks are
// plain divs sized by percentage against one shared scale, with direct value
// labels. Supports one or two categorical series; a legend shows for two.
import { cn } from '@/lib/utils';

export interface BarSeries {
  key: string;
  label: string;
  color: string; // CSS color, e.g. 'var(--viz-bus)'
}
export interface BarDatum {
  /** Stable unique key. Pass it when labels can collide (e.g. two providers with
   *  the same name) — keying by label alone dropped one of the colliding bars. */
  id?: string;
  label: string;
  values: Record<string, number>;
}

export function BarChart({
  data,
  series,
  valueSuffix = '',
  emptyLabel = 'No data yet.',
}: {
  data: BarDatum[];
  series: BarSeries[];
  valueSuffix?: string;
  emptyLabel?: string;
}) {
  const max = Math.max(
    1,
    ...data.flatMap((d) => series.map((s) => d.values[s.key] ?? 0)),
  );
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <div className="space-y-4">
      {series.length > 1 && (
        <div className="flex flex-wrap gap-4">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="size-3 rounded-[3px]" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div className="space-y-3">
        {data.map((d, i) => (
          <div key={d.id ?? `${d.label}-${i}`} className="space-y-1">
            <p className="truncate text-sm font-medium">{d.label}</p>
            <div className={cn('space-y-1')}>
              {series.map((s) => {
                const v = d.values[s.key] ?? 0;
                const pct = Math.max(v > 0 ? 3 : 0, (v / max) * 100);
                return (
                  <div key={s.key} className="flex items-center gap-2">
                    <div className="h-4 flex-1 overflow-hidden rounded-sm bg-[var(--viz-track)]/60">
                      <div
                        className="h-full rounded-sm"
                        style={{ width: `${pct}%`, backgroundColor: s.color }}
                        title={`${series.length > 1 ? s.label + ': ' : ''}${v}${valueSuffix}`}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {v}
                      {valueSuffix}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
