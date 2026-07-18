'use client';
import { useActionState } from 'react';
import Link from 'next/link';
import { agencyLoginAction, type FormState } from '@/features/agency/actions';
import { LoginCard } from '@/components/auth/login-card';

export function AgencyLoginForm({ pending }: { pending: boolean }) {
  const [state, action, submitting] = useActionState<FormState, FormData>(
    agencyLoginAction,
    {},
  );
  return (
    <LoginCard
      title="Service Provider Login"
      action={action}
      submitting={submitting}
      error={state.error}
      emailLabel="Provider email"
      passwordLabel="Provider password"
      submitLabel="Login"
      banner={
        pending ? (
          <p className="mb-4 rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm text-primary">
            Application submitted — an admin will review it. You can sign in once
            it’s approved.
          </p>
        ) : null
      }
      backHref="/"
      footer={
        <Link
          href="/agency/register"
          className="block rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-center text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
        >
          Apply as agency
        </Link>
      }
    />
  );
}
