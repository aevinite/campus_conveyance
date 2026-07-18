'use client';
import { Suspense, useActionState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { loginAction, googleLoginAction, type AuthState } from '@/features/auth/actions';
import { LoginCard } from '@/components/auth/login-card';

function LoginInner() {
  const [state, action, pending] = useActionState<AuthState, FormData>(loginAction, {});
  // Google / OAuth failures come back as ?error= (from googleLoginAction and the
  // /auth/callback route). Surface it — previously it was ignored, so a failed
  // Google sign-in looked like nothing happened.
  const oauthError = useSearchParams().get('error');
  return (
    <LoginCard
      title="Welcome back"
      description="Sign in to your Campus Conveyance account."
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

export default function LoginPage() {
  // useSearchParams must sit inside a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
