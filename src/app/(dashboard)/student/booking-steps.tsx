import { Check } from 'lucide-react';

const STEPS = ['Pick your campus', 'Pick your bus', 'Reserve & pay'];

/**
 * The one map of the whole booking journey, shown on every page of the flow
 * (campus list → campus → route) so the student always knows where they are
 * and what comes next.
 */
export function BookingSteps({ active }: { active: 1 | 2 | 3 }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
      {STEPS.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const done = n < active;
        const current = n === active;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                done
                  ? 'bg-success text-white'
                  : current
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-muted-foreground'
              }`}
            >
              {done ? <Check className="size-3.5" /> : n}
            </span>
            <span
              className={
                current ? 'font-semibold' : done ? 'text-foreground' : 'text-muted-foreground'
              }
            >
              {label}
            </span>
            {n < STEPS.length && <span className="mx-1 h-px w-6 bg-border sm:w-10" />}
          </li>
        );
      })}
    </ol>
  );
}
