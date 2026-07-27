import LandingClient from './landing-client';

// The marketing landing has no server-side data (the stats band loads client-side
// from /api/public-stats), so prerender it as STATIC HTML served straight from the
// CDN — an instant first paint instead of a serverless render on every visit. The
// proxy still runs at the edge, so app visitors are redirected to /login as before.
export const dynamic = 'force-static';

export default function Page() {
  return <LandingClient />;
}
