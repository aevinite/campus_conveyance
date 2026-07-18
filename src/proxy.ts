import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { isMaintenanceOn } from '@/lib/maintenance';

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
  // Public portals for the other actors. These exact prefixes do NOT match
  // the protected '/agency' and '/aevinite' dashboards (guarded by their layouts).
  '/agency/login', '/agency/register', '/aevinite/login', '/driver/login',
];

export async function proxy(request: NextRequest) {
  const { response, user, role } = await updateSession(request);
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC.some((p) => path === p || path.startsWith(p + '/'));

  // Maintenance mode: block everyone except the admin (who needs the panel to
  // turn it back off). The admin area and the maintenance page stay reachable.
  if (role !== 'SUPER_ADMIN' && (await isMaintenanceOn())) {
    const allowed =
      path === '/maintenance' ||
      path === '/aevinite/login' ||
      path.startsWith('/aevinite') ||
      path.startsWith('/auth') ||
      // /confirm (signup) and /reset (password) are client-hash flows that live
      // OUTSIDE /auth — without these, emailed confirmation/reset links become
      // dead ends whenever maintenance mode is on.
      path === '/confirm' ||
      path === '/reset';
    if (!allowed) {
      return NextResponse.rewrite(new URL('/maintenance', request.url));
    }
  }

  if (!user && !isPublic) {
    // Send admins/agencies to their own login page instead of the general one,
    // so typing /aevinite (or /agency) lands on the right sign-in screen.
    const loginPath = path.startsWith('/aevinite')
      ? '/aevinite/login'
      : path.startsWith('/agency')
        ? '/agency/login'
        : path.startsWith('/driver')
          ? '/driver/login'
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
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
