import { BrandLoader } from '@/components/brand-loader';

/**
 * Instant navigation feedback: shown via React Suspense while the next route's
 * server component streams in, so clicking a link never looks frozen.
 */
export default function Loading() {
  return <BrandLoader />;
}
