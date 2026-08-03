import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { isAppRequest } from '@/lib/app-context';

/**
 * A "← back" link that adapts to where it's shown.
 *
 * Inside the native app the plain muted-grey text was hard to see against the
 * header and looked unfinished, so there we render a clearly-visible pill
 * button. On the website it stays the subtle inline link it has always been.
 * Server component — it reads the request UA to decide (see isAppRequest).
 */
export async function AppBackLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  const app = await isAppRequest();
  if (app) {
    return (
      <Link
        href={href}
        className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors active:bg-muted"
      >
        <ArrowLeft className="size-4 text-primary" /> {label}
      </Link>
    );
  }
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4" /> {label}
    </Link>
  );
}
