import { Check } from 'lucide-react';

const STEPS = ['Pick your campus', 'Pick your bus', 'Reserve & pay'];

/**
 * The one map of the whole booking journey, shown on every page of the flow
 * (campus list → campus → route) so the student always knows where they are
 * and what comes next. `compact` renders a slim app-style progress bar
 * ("Step N of 3" + a segmented meter) that takes far less vertical space than
 * the full labelled rail used on the website.
 */
export function BookingSteps({ active, compact = false }: { active: 1 | 2 | 3; compact?: boolean }) {
  if (compact) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold uppercase tracking-wide text-primary">
            Step {active} of {STEPS.length}
          </span>
          <span className="font-medium text-muted-foreground">{STEPS[active - 1]}</span>
        </div>
        <div className="flex gap-1.5">
          {STEPS.map((label, i) => (
            <span
              key={label}
              className={`h-1.5 flex-1 rounded-full ${i < active ? 'bg-primary' : 'bg-secondary'}`}
            />
          ))}
        </div>
      </div>
    );
  }

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
