import { BrandLoader } from '@/components/brand-loader';

/** Top-level navigation fallback while a route's server component streams in. */
export default function Loading() {
  return <BrandLoader />;
}
