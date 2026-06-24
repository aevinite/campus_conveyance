import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { dashboardFor } from '@/lib/rbac/roles';

const PUBLIC = ['/', '/login', '/register', '/verify', '/forgot', '/reset', '/auth'];

export async function proxy(request: NextRequest) {
  const { response, user, role } = await updateSession(request);
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC.some((p) => path === p || path.startsWith(p + '/'));

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  // Only bounce a logged-in user off the auth pages once we can resolve their
  // role — otherwise dashboardFor() would send them back to /login in a loop.
  if (user && role && (path === '/login' || path === '/register')) {
    return NextResponse.redirect(new URL(dashboardFor(role), request.url));
  }
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
