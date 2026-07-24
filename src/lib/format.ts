// Small shared display formatters that `format-date.ts` doesn't cover.
// (Date/time formatting lives in format-date.ts, pinned to IST — use that.)

/** Paise/cents → "₹1,200" (Indian grouping). Null/undefined → "—". */
export function rupees(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return `₹${Math.round(cents / 100).toLocaleString('en-IN')}`;
}

/** "5 min ago" style relative label for recent activity feeds. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
