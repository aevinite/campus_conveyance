import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { dashboardFor, roleFromClaims } from '@/lib/rbac/roles';

const PUBLIC = ['/', '/login', '/register', '/verify', '/forgot', '/reset', '/auth'];

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC.some((p) => path === p || path.startsWith(p + '/'));

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (user && (path === '/login' || path === '/register')) {
    const role = roleFromClaims(user.app_metadata as Record<string, unknown>);
    return NextResponse.redirect(new URL(dashboardFor(role), request.url));
  }
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
