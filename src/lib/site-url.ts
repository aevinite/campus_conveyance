// Canonical public origin of the site (no trailing slash), used for emailed
// links, metadataBase, robots and sitemap.
//
// Order: explicit NEXT_PUBLIC_SITE_URL → Vercel's production domain → the
// current Vercel deployment URL → the known production URL. Never throws, so a
// missing env var can't crash signup / reset flows.
export const DEFAULT_SITE_URL = 'https://campus-conveyance.vercel.app';

function normalize(raw: string): string {
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProto.replace(/\/+$/, '');
}

export function getSiteUrl(): string {
  const candidates = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
  ];
  for (const c of candidates) {
    const v = c?.trim();
    if (v) return normalize(v);
  }
  return DEFAULT_SITE_URL;
}
