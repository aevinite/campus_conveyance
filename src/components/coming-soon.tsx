import type { LucideIcon } from 'lucide-react';
import { Sparkles } from 'lucide-react';

/**
 * Polished placeholder for dashboards whose features are still being built.
 * Keeps the surface on-brand instead of showing bare text.
 */
export function ComingSoon({
  icon: Icon,
  title,
  description,
  items = [],
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  items?: string[];
}) {
  return (
    <section className="mx-auto max-w-3xl">
      <div className="relative overflow-hidden rounded-3xl border border-border bg-card p-8 shadow-sm sm:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(70% 120% at 100% 0%, color-mix(in oklch, var(--primary) 16%, transparent), transparent 60%)',
          }}
        />
        <div className="mb-6 grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="size-7" />
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-semibold uppercase tracking-widest text-primary">
          <Sparkles className="size-3.5" /> Coming soon
        </span>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-3 max-w-xl text-muted-foreground">{description}</p>
        {items.length > 0 && (
          <ul className="mt-6 grid gap-2 sm:grid-cols-2">
            {items.map((it) => (
              <li
                key={it}
                className="flex items-center gap-2.5 rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm"
              >
                <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                {it}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
