'use client';
import { Suspense, useActionState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { loginAction, googleLoginAction, type AuthState } from '@/features/auth/actions';
import { LoginCard } from '@/components/auth/login-card';

function StudentLoginInner() {
  const [state, action, pending] = useActionState<AuthState, FormData>(loginAction, {});
  // Google / OAuth failures come back as ?error= (from googleLoginAction and the
  // /auth/callback route). Surface it — previously it was ignored, so a failed
  // Google sign-in looked like nothing happened.
  const params = useSearchParams();
  const oauthError = params.get('error');
  // ?confirmed=1 — the app was opened from an email-confirmation link (the link
  // carries no session, so the rider signs in once here).
  const confirmed = params.get('confirmed') === '1';
  return (
    <LoginCard
      title={confirmed ? 'Email confirmed' : 'Welcome back'}
      description={
        confirmed
          ? 'Your email is confirmed — sign in to continue.'
          : 'Sign in to your Campus Conveyance account.'
      }
      action={action}
      submitting={pending}
      error={state.error ?? oauthError ?? undefined}
      googleAction={googleLoginAction}
      footer={
        <div className="flex justify-between text-sm">
          <Link href="/register" className="font-medium text-primary transition-colors hover:text-primary/70">
            Create account
          </Link>
          <Link href="/forgot" className="font-medium text-primary transition-colors hover:text-primary/70">
            Forgot password?
          </Link>
        </div>
      }
    />
  );
}

/**
 * The user (student/parent) email+password + Google login form. Shared by the
 * browser login page and, inside the native app, the "User" tab of the
 * App login chooser. useSearchParams must sit inside a Suspense boundary.
 */
export function StudentLogin() {
  return (
    <Suspense fallback={null}>
      <StudentLoginInner />
    </Suspense>
  );
}
