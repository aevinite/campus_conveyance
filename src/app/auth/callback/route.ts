import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/features/auth/session';
import { isAccountDeactivated } from '@/features/auth/account-status';
import { dashboardFor } from '@/lib/rbac/roles';

// Cookie-authed, per-request OAuth/verification callback — declare the runtime
// explicitly to match the other route handlers.
export const runtime = 'nodejs';

// Only accept an in-app relative path for `next`. Rejects absolute URLs and
// protocol-relative / backslash tricks (`//evil.com`, `/\evil.com`) so `next`
// can never become an open redirect off our origin.
function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith('/')) return null;
  if (next.startsWith('//') || next.startsWith('/\\')) return null;
  return next;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeNext(searchParams.get('next'));

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
    // Deny soft-deleted (removed) accounts here too, consistent with the "check
    // access at every gate" design — even though the dashboard layout re-checks
    // one hop later.
    const { userId, role } = await getSessionClaims(db);
    if (userId && (await isAccountDeactivated(db, userId, role))) {
      await db.auth.signOut();
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent('This account is no longer active.')}`,
      );
    }
    // No explicit destination (e.g. Google sign-in or email verification) →
    // send the user straight to the dashboard that matches their role.
    if (!next) {
      return NextResponse.redirect(`${origin}${dashboardFor(role)}`);
    }
  }
  return NextResponse.redirect(`${origin}${next ?? '/login'}`);
}
