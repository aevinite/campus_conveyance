import Link from 'next/link';
import { ArrowLeft, ArrowRight } from 'lucide-react';

/**
 * Minimal prev/next pager for server-paginated list pages.
 * - `param` lets two independent lists share one page (e.g. pending vs rejected
 *   on the admin requests page) by using different query keys.
 * - `params` (the page's current searchParams) are preserved so paging one list
 *   doesn't reset the other's page or drop filters like ?q/?kind.
 */
export function Pager({
  page,
  totalPages,
  basePath,
  param = 'page',
  params,
}: {
  page: number;
  totalPages: number;
  basePath: string;
  param?: string;
  params?: Record<string, string | undefined>;
}) {
  if (totalPages <= 1) return null;
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v && k !== param) sp.set(k, v);
    }
    if (p > 1) sp.set(param, String(p));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const cls =
    'inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted';
  return (
    <div className="flex items-center justify-between pt-2">
      {page > 1 ? (
        <Link href={href(page - 1)} className={cls}>
          <ArrowLeft className="size-4" /> Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-sm text-muted-foreground">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={href(page + 1)} className={cls}>
          Next <ArrowRight className="size-4" />
        </Link>
      ) : (
        <span />
      )}
    </div>
  );
}

/** Clamp a raw ?page value and return { page, offset } for a given page size. */
export function pageParams(raw: string | undefined, size: number): { page: number; offset: number } {
  const page = Math.max(1, Number(raw) || 1);
  return { page, offset: (page - 1) * size };
}
