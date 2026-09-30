import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { isMaintenanceOn } from '@/lib/maintenance';
import { dashboardFor } from '@/lib/rbac/roles';

// Kept in sync with APP_UA_MARKER in '@/lib/app-context'. Inlined here rather
// than imported because that module pulls in next/headers, which is not
// available in the middleware/proxy runtime.
const APP_UA_MARKER = 'CampusConveyanceApp';

const PUBLIC = [
  '/', '/login', '/register', '/verify', '/forgot', '/reset', '/auth',
  // The signup confirmation link lands here with the session in the URL #hash
  // (only the browser can read it). It MUST be public — otherwise the proxy
  // redirects the not-yet-signed-in visitor to /login before /confirm can
  // establish the session, and clicking the email link never logs anyone in.
  '/confirm',
  '/maintenance',
  // Anonymous endpoint behind the landing-page stats band — without this the
  // proxy redirects the fetch to /login and the numbers never load for
  // logged-out visitors.
  '/api/public-stats',
  // Server-to-server cron endpoint (pg_cron → outbox drain). It carries no
  // session cookie — only a service-role bearer it validates itself — so the
  // proxy must not redirect it to /login.
  '/api/cron',
  // Public portals for the other actors. These exact prefixes do NOT match
  // the protected '/agency' and '/aevinite' dashboards (guarded by their layouts).
  '/agency/login', '/agency/register', '/agency/forgot', '/aevinite/login', '/driver/login',
  // School / college self-signup + login portal (the '/institution' dashboard
  // itself stays protected by its panel layout).
  '/institution/login', '/institution/register', '/institution/forgot',
];

// Areas that REQUIRE a session. A logged-out visitor on one of these (minus the
// PUBLIC login/register pages above) is redirected to the matching login. Any
// other unknown path is passed through so it reaches the branded not-found page
// with a real 404, instead of bouncing to /login.
const PROTECTED = ['/student', '/parent', '/aevinite', '/agency', '/driver', '/institution', '/api'];

// Seconds a client/crawler should wait before retrying during maintenance.
const MAINTENANCE_RETRY_AFTER = '600';

// Maintenance answers 503 + Retry-After (so crawlers/monitors don't index or
// cache the pause as the real page) while still showing the maintenance page.
// A proxy rewrite can't change the status code, so for ordinary HTML page loads
// we fetch the rendered /maintenance page and re-serve its body with 503.
// Client-router (RSC) and server-action requests keep the plain rewrite so the
// in-app router still renders the maintenance screen; other requests (APIs,
// assets) get a bare 503.
async function maintenanceResponse(request: NextRequest): Promise<NextResponse> {
  const target = new URL('/maintenance', request.url);
  const baseHeaders = { 'Retry-After': MAINTENANCE_RETRY_AFTER, 'Cache-Control': 'no-store' };
  const h = request.headers;
  const isRouterRequest = h.has('rsc') || h.has('next-action') || h.has('next-router-state-tree');
  if (isRouterRequest) {
    return NextResponse.rewrite(target, { headers: baseHeaders });
  }
  const wantsHtml = request.method === 'GET' && (h.get('accept') ?? '').includes('text/html');
  if (!wantsHtml) {
    return new NextResponse('Service temporarily unavailable (maintenance).', {
      status: 503,
      headers: { ...baseHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  try {
    // /maintenance is on the maintenance allow-list, so this can't loop.
    const page = await fetch(target, {
      headers: { 'user-agent': h.get('user-agent') ?? '', accept: 'text/html' },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (page.ok) {
      const headers = new Headers();
      page.headers.forEach((value, key) => {
        // fetch already decoded the body; drop hop/encoding headers + cookies.
        if (!['content-encoding', 'content-length', 'transfer-encoding', 'set-cookie', 'connection'].includes(key)) {
          headers.set(key, value);
        }
      });
      for (const [k, v] of Object.entries(baseHeaders)) headers.set(k, v);
      return new NextResponse(page.body, { status: 503, headers });
    }
  } catch {
    // fall through to the rewrite below
  }
  // Fallback: still show the page (status stays 200 here, but Retry-After is set).
  return NextResponse.rewrite(target, { headers: baseHeaders });
}

export async function proxy(request: NextRequest) {
  const { response, user, role } = await updateSession(request);
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC.some((p) => path === p || path.startsWith(p + '/'));

  // Inside the native app we skip the public marketing landing entirely: opening
  // the app should go straight to the login chooser (or the viewer's dashboard
  // if already signed in). In a browser, '/' still shows the full landing page.
  const isApp = (request.headers.get('user-agent') ?? '').includes(APP_UA_MARKER);
  if (isApp && path === '/') {
    // A brand-new Google signup can land here before the role claim is minted
    // (the access-token hook / profile-default trigger lags the first token).
    // Fall back to the STUDENT dashboard for an authenticated-but-roleless user
    // rather than bouncing them to /login — a dead-end at the app login chooser.
    // Mirrors the web /auth/callback fallback; the dashboard guard re-checks and
    // redirects if the resolved role turns out to be something else.
    const dest = user ? (role ? dashboardFor(role) : '/student') : '/login';
    return NextResponse.redirect(new URL(dest, request.url));
  }

  // Maintenance mode: block everyone except the admin (who needs the panel to
  // turn it back off). The admin area and the maintenance page stay reachable.
  // The Website and App switches are independent: the native app is recognised
  // by its User-Agent marker (see isApp above), so we gate only that audience.
  const clientKind = isApp ? 'app' : 'website';
  if (role !== 'SUPER_ADMIN' && (await isMaintenanceOn(clientKind))) {
    const allowed =
      path === '/maintenance' ||
      path === '/aevinite/login' ||
      path.startsWith('/aevinite') ||
      // Campus admins are operators (like the platform admin), not the public
      // audience the website switch targets — don't collateral-block their
      // console + login when website maintenance is on.
      path.startsWith('/institution') ||
      path.startsWith('/auth') ||
      // /confirm (signup) and /reset (password) are client-hash flows that live
      // OUTSIDE /auth — without these, emailed confirmation/reset links become
      // dead ends whenever maintenance mode is on.
      path === '/confirm' ||
      path === '/reset' ||
      // The cron drain must keep working while maintenance mode is on.
      path.startsWith('/api/cron');
    if (!allowed) {
      return maintenanceResponse(request);
    }
  }

  const isProtected = PROTECTED.some((p) => path === p || path.startsWith(p + '/'));
  if (!user && !isPublic && isProtected) {
    // Send admins/agencies to their own login page instead of the general one,
    // so typing /aevinite (or /agency) lands on the right sign-in screen.
    const loginPath = path.startsWith('/aevinite')
      ? '/aevinite/login'
      : path.startsWith('/agency')
        ? '/agency/login'
        : path.startsWith('/driver')
          ? '/driver/login'
          : path.startsWith('/institution')
            ? '/institution/login'
            : '/login';
    return NextResponse.redirect(new URL(loginPath, request.url));
  }
  // NOTE: we intentionally do NOT auto-redirect a logged-in user away from the
  // login/register pages. The landing page sends Student/Agency/Driver to the
  // common /login screen, and it must always render the login form even if a
  // stale session (e.g. an admin) still exists — otherwise clicking a role
  // would bounce straight to that role's dashboard. A fresh sign-in overwrites
  // the old session, and loginAction still redirects to the correct dashboard.
  return response;
}

export const config = {
  matcher: [
    // Exclude PWA assets (manifest + service worker) and static images so they
    // are served directly. Without this, a logged-out visitor's request for the
    // manifest or sw.js is redirected to /login (returning HTML), which breaks
    // install / PWABuilder detection and public-page push registration.
    // robots.txt / sitemap.xml are public metadata routes — skip the proxy.
    '/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|webmanifest)$).*)',
  ],
};
