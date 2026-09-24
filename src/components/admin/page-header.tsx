import { cn } from '@/lib/utils';

/**
 * Standard admin page header — a small brand-tone eyebrow (breadcrumb-style),
 * a bold display title, an optional subtitle, and a right-aligned actions slot.
 * Gives every admin page the same "Dashboard / big title / actions" rhythm as
 * the reference layout. Purely presentational.
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        {eyebrow && (
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">
            {eyebrow}
          </span>
        )}
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground sm:text-base">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
