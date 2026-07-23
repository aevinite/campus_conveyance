// Centralized date/time formatting, ALWAYS pinned to IST. Server components
// render on Vercel (UTC), so any Intl/toLocale* call without timeZone shows every
// time ~5.5h off for Indian users. Use these helpers everywhere instead of ad-hoc
// formatters so that bug can't reappear per-file.
const TZ = 'Asia/Kolkata';
const LOCALE = 'en-IN';

const fmt = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(LOCALE, { ...opts, timeZone: TZ });

const longDate = fmt({ dateStyle: 'long' });
const mediumDate = fmt({ dateStyle: 'medium' });
const shortDate = fmt({ month: 'short', day: 'numeric' });
const weekdayDate = fmt({ weekday: 'long', month: 'long', day: 'numeric' });
const dateTime = fmt({ dateStyle: 'medium', timeStyle: 'short' });
const compactDateTime = fmt({ month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const timeOnly = fmt({ hour: 'numeric', minute: '2-digit' });

type DateInput = string | number | Date | null | undefined;

function parse(v: DateInput): Date | null {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** e.g. "23 July 2026" */
export function formatDate(v: DateInput, fallback = '—'): string {
  const d = parse(v);
  return d ? longDate.format(d) : fallback;
}
/** e.g. "23 Jul 2026" */
export function formatDateMedium(v: DateInput, fallback = '—'): string {
  const d = parse(v);
  return d ? mediumDate.format(d) : fallback;
}
/** e.g. "23 Jul" */
export function formatShortDate(v: DateInput, fallback = '—'): string {
  const d = parse(v);
  return d ? shortDate.format(d) : fallback;
}
/** e.g. "Thursday, 23 July" */
export function formatWeekdayDate(v: DateInput, fallback = '—'): string {
  const d = parse(v);
  return d ? weekdayDate.format(d) : fallback;
}
/** e.g. "23 Jul 2026, 3:00 pm" */
export function formatDateTime(v: DateInput, fallback = '—'): string {
  const d = parse(v);
  return d ? dateTime.format(d) : fallback;
}
/** e.g. "23 Jul, 3:00 pm" — compact, no year (notification/inbox rows). */
export function formatCompactDateTime(v: DateInput, fallback = '—'): string {
  const d = parse(v);
  return d ? compactDateTime.format(d) : fallback;
}
/** e.g. "3:00 pm" */
export function formatTime(v: DateInput, fallback = '—'): string {
  const d = parse(v);
  return d ? timeOnly.format(d) : fallback;
}
