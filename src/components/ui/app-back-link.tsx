import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

/**
 * A clearly-visible pill-style "← back" link, used across the app AND the
 * website (the old subtle grey text was easy to miss). Renders the same on both
 * surfaces.
 */
export function AppBackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-muted active:bg-muted"
    >
      <ArrowLeft className="size-4 text-primary" /> {label}
    </Link>
  );
}
