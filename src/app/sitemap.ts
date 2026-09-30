import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/site-url';

// Only the public, indexable pages. Everything behind a login is excluded
// (and disallowed in robots.ts).
export default function sitemap(): MetadataRoute.Sitemap {
  const site = getSiteUrl();
  const pages: Array<{ path: string; priority: number; changeFrequency: 'weekly' | 'monthly' }> = [
    { path: '/', priority: 1, changeFrequency: 'weekly' },
    { path: '/login', priority: 0.6, changeFrequency: 'monthly' },
    { path: '/register', priority: 0.7, changeFrequency: 'monthly' },
    { path: '/agency/register', priority: 0.5, changeFrequency: 'monthly' },
    { path: '/institution/register', priority: 0.5, changeFrequency: 'monthly' },
  ];
  return pages.map((p) => ({
    url: `${site}${p.path === '/' ? '' : p.path}`,
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));
}
