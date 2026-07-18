'use client';
import { useActionState } from 'react';
import Link from 'next/link';
import { loginAction, type AuthState } from '@/features/auth/actions';
import { LoginCard } from '@/components/auth/login-card';

export default function DriverLoginPage() {
  const [state, action, pending] = useActionState<AuthState, FormData>(loginAction, {});
  // No "Continue with Google" here: Google sign-up defaults new users to STUDENT
  // (the handle_new_user trigger), so a driver clicking it would land on a
  // student account and never reach the driver panel. Drivers are created by
  // their agency with an email + password — that's the only way in.
  return (
    <LoginCard
      title="Driver Login"
      description="Sign in with the email and password your agency gave you."
      action={action}
      submitting={pending}
      error={state.error}
      submitLabel="Login"
      footer={
        <p className="text-center text-sm">
          <Link href="/forgot" className="font-medium text-primary transition-colors hover:text-primary/70">
            Forgot password?
          </Link>
        </p>
      }
    />
  );
}
