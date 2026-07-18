// Dependency-free SVG donut. Server-renderable. Each segment carries a native
// tooltip; identity is shown via a labelled legend (never color alone). Used for
// status proportions (paid vs pending), so segments take status colors.

export interface DonutSegment {
  label: string;
  value: number;
  color: string; // CSS color, e.g. 'var(--viz-paid)'
}

export function DonutChart({
  segments,
  centerValue,
  centerLabel,
}: {
  segments: DonutSegment[];
  centerValue?: string;
  centerLabel?: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const size = 160;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const gap = total > 0 ? 2 : 0; // 2px surface gap between segments

  let offset = 0;
  const arcs =
    total > 0
      ? segments
          .filter((s) => s.value > 0)
          .map((s) => {
            const frac = s.value / total;
            const len = Math.max(0, frac * c - gap);
            const dash = `${len} ${c - len}`;
            const arc = { ...s, dash, dashoffset: -offset };
            offset += frac * c;
            return arc;
          })
      : [];

  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={centerLabel}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--viz-track)"
            strokeWidth={stroke}
            opacity={0.5}
          />
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {arcs.map((a) => (
              <circle
                key={a.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={a.color}
                strokeWidth={stroke}
                strokeDasharray={a.dash}
                strokeDashoffset={a.dashoffset}
                strokeLinecap="butt"
              >
                <title>{`${a.label}: ${a.value}`}</title>
              </circle>
            ))}
          </g>
        </svg>
        {(centerValue || centerLabel) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            {centerValue && <span className="text-2xl font-bold">{centerValue}</span>}
            {centerLabel && <span className="text-xs text-muted-foreground">{centerLabel}</span>}
          </div>
        )}
      </div>
      <ul className="space-y-2">
        {segments.map((s) => {
          const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
          return (
            <li key={s.label} className="flex items-center gap-2 text-sm">
              <span className="size-3 rounded-[3px]" style={{ backgroundColor: s.color }} />
              <span className="text-muted-foreground">{s.label}</span>
              <span className="font-medium tabular-nums">
                {s.value} <span className="text-muted-foreground">({pct}%)</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
