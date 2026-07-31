import { BrandLoader } from '@/components/brand-loader';

/**
 * Navigation feedback for the driver panel: shown via React Suspense while the
 * next driver page streams in, so a slow page shows the branded loader rather
 * than a blank shell.
 */
export default function Loading() {
  return <BrandLoader />;
}
