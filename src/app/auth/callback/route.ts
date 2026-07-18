import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSessionRole } from '@/features/auth/session';
import { dashboardFor } from '@/lib/rbac/roles';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next');

  // The OAuth provider can hand us back an error instead of a code (e.g. the user
  // cancelled, or consent failed). Forward it to the login page so it's shown
  // rather than silently landing on a blank login.
  const providerError = searchParams.get('error_description') ?? searchParams.get('error');
  if (providerError) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(providerError)}`);
  }

  if (code) {
    const db = await createClient();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (error) {
      // Exchange failed — surface it instead of quietly redirecting to /login.
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent('Sign-in could not be completed. Please try again.')}`,
      );
    }
    // No explicit destination (e.g. Google sign-in or email verification) →
    // send the user straight to the dashboard that matches their role.
    if (!next) {
      const role = await getSessionRole(db);
      return NextResponse.redirect(`${origin}${dashboardFor(role)}`);
    }
  }
  return NextResponse.redirect(`${origin}${next ?? '/login'}`);
}
