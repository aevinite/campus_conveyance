import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/site-url';

// Public marketing + sign-in pages are crawlable; operator panels, rider
// dashboards, APIs and one-time auth links are not.
export default function robots(): MetadataRoute.Robots {
  const site = getSiteUrl();
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/aevinite',
          '/agency',
          '/driver',
          '/institution',
          '/student',
          '/parent',
          '/api/',
          '/auth/',
          '/confirm',
          '/reset',
          '/verify',
          '/maintenance',
        ],
      },
    ],
    sitemap: `${site}/sitemap.xml`,
    host: site,
  };
}
