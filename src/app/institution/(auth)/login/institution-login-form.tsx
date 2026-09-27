'use client';
import { useActionState } from 'react';
import Link from 'next/link';
import { institutionLoginAction, type FormState } from '@/features/institution/auth-actions';
import { LoginCard } from '@/components/auth/login-card';

export function InstitutionLoginForm({ pending }: { pending: boolean }) {
  const [state, action, submitting] = useActionState<FormState, FormData>(
    institutionLoginAction,
    {},
  );
  return (
    <LoginCard
      title="School / College Login"
      description="Sign in to your campus oversight console."
      action={action}
      submitting={submitting}
      error={state.error}
      emailLabel="Campus email"
      passwordLabel="Password"
      submitLabel="Login"
      banner={
        pending ? (
          <p className="mb-4 rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm text-primary">
            Application submitted — please confirm your email, then an admin will
            review your campus. You can sign in once it&apos;s approved.
          </p>
        ) : null
      }
      backHref="/"
      footer={
        <div className="space-y-3">
          <Link
            href="/institution/forgot"
            className="block text-center text-sm font-medium text-primary transition-colors hover:text-primary/70"
          >
            Forgot password?
          </Link>
          <Link
            href="/institution/register"
            className="block rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-center text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
          >
            Register your school / college
          </Link>
        </div>
      }
    />
  );
}
