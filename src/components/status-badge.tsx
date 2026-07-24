import { cn } from '@/lib/utils';

// Small pill for statuses / flags across the admin operations pages. Colour is
// chosen from the value so CONFIRMED/paid read green, pending amber, etc.
const TONES: Record<string, string> = {
  green: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
  amber: 'bg-amber-500/12 text-amber-600 dark:text-amber-400 border-amber-500/25',
  red: 'bg-rose-500/12 text-rose-600 dark:text-rose-400 border-rose-500/25',
  blue: 'bg-sky-500/12 text-sky-600 dark:text-sky-400 border-sky-500/25',
  gray: 'bg-muted text-muted-foreground border-border',
};

type Tone = keyof typeof TONES;

function toneFor(value: string): Tone {
  const v = value.toUpperCase();
  if (['CONFIRMED', 'PAID', 'ONLINE', 'ACTIVE', 'REACHED', 'BOARDED', 'HANDLED', 'VERIFIED', 'YES'].includes(v)) return 'green';
  if (['PENDING', 'WAITLISTED', 'NEXT', 'NEW', 'UNPAID'].includes(v)) return 'amber';
  if (['CANCELLED', 'REJECTED', 'SKIPPED', 'OFFLINE', 'INACTIVE', 'GOT_OFF', 'NO'].includes(v)) return 'red';
  if (['NOTIFIED'].includes(v)) return 'blue';
  return 'gray';
}

export function StatusBadge({ value, tone, className }: { value: string; tone?: Tone; className?: string }) {
  const t = tone ?? toneFor(value);
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONES[t],
        className,
      )}
    >
      {value.replace(/_/g, ' ')}
    </span>
  );
}

/** Yes/No pill for booleans (paid, AC, verified, online, …). */
export function BoolBadge({ value, yes = 'Yes', no = 'No' }: { value: boolean; yes?: string; no?: string }) {
  return <StatusBadge value={value ? yes : no} tone={value ? 'green' : 'gray'} />;
}
