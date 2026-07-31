import { BrandMark } from '@/components/brand';
import { cn } from '@/lib/utils';

/**
 * Shared branded loader — a spinning bus-yellow ring around the brandmark. Shown
 * on every screen while it loads so the loader looks identical everywhere: the
 * boot splash (AppSplash) and every route-navigation `loading.tsx` fallback use
 * it, instead of a bare grey spinner on some screens and the branded splash on
 * others. Server-safe (no hooks), so it can be the default export of a
 * `loading.tsx`.
 */
export function BrandLoader({
  className,
  label = 'Loading',
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div className={cn('brand-loader', className)} role="status" aria-label={label}>
      <div className="brand-loader__mark">
        <span className="brand-loader__ring" aria-hidden />
        <BrandMark className="brand-loader__logo" />
      </div>
    </div>
  );
}
