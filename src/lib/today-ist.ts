/**
 * Today's date in IST (Asia/Kolkata) as an ISO `YYYY-MM-DD` string. Matches the
 * server-side `(now() at time zone 'Asia/Kolkata')::date` used by the per-day
 * driver-change table, so client reads line up with the SQL default. `en-CA`
 * formats as YYYY-MM-DD.
 */
export function todayIST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}
