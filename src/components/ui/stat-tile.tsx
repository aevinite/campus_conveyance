// A compact stat tile: icon chip + uppercase label + tabular value, with an
// optional sub-line and an `urgent` (amber) variant. Shared by the parent
// dashboard summary strip and the pre-booking platform-stats band.
export function StatTile({
  icon,
  label,
  value,
  sub,
  urgent = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  urgent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-3 sm:p-4 ${
        urgent ? 'border-warning/40 bg-warning/[0.08]' : 'border-border bg-card'
      }`}
    >
      <span
        className={`grid size-8 place-items-center rounded-lg ${
          urgent ? 'bg-warning/15 text-warning' : 'bg-primary/10 text-primary'
        }`}
      >
        {icon}
      </span>
      <p className="mt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`tnum text-xl font-bold leading-tight ${urgent ? 'text-warning' : ''}`}>{value}</p>
      {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
