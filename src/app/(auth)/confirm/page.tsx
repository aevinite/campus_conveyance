'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';
import { buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { dashboardFor, roleFromClaims } from '@/lib/rbac/roles';

type Status = 'loading' | 'invalid';

export default function ConfirmPage() {
  const [status, setStatus] = useState<Status>('loading');

  // The email-confirmation link lands here with the new session in the URL
  // #hash (Supabase's implicit flow) — which only the browser can read. We
  // establish the session (writing the auth cookies), then send the freshly
  // confirmed user straight to the dashboard that matches their role.
  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { detectSessionInUrl: false } },
    );
    (async () => {
      try {
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const accessToken = hash.get('access_token');
        const refreshToken = hash.get('refresh_token');
        const code = new URL(window.location.href).searchParams.get('code');

        let session = null;
        if (accessToken && refreshToken) {
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
          session = data.session;
        } else if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          session = data.session;
        } else {
          const { data } = await supabase.auth.getSession();
          session = data.session;
        }
        if (!session) throw new Error('missing confirmation session');

        const role =
          roleFromClaims(session.user.app_metadata) ??
          roleFromClaims(session.user.user_metadata);
        // A freshly-confirmed agency is still PENDING admin approval — the
        // signup flow parks them on /agency/login?pending=1, so match that
        // instead of dropping them into the panel. Tear the session down first
        // so they aren't stranded logged-in on a login page.
        if (role === 'AGENCY') {
          await supabase.auth.signOut();
          window.location.replace('/agency/login?pending=1');
          return;
        }
        // Full navigation (not router.push) so the server re-reads the auth
        // cookies just written and renders the protected dashboard.
        window.location.replace(dashboardFor(role));
      } catch {
        setStatus('invalid');
      }
    })();
  }, []);

  return (
    <Card className="w-full max-w-sm shadow-lg">
      <CardHeader>
        <CardTitle className="text-xl">
          {status === 'invalid' ? 'Confirmation failed' : 'Confirming your email…'}
        </CardTitle>
        <CardDescription>
          {status === 'invalid'
            ? 'This confirmation link is invalid or has expired.'
            : 'Signing you in and taking you to your dashboard.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {status === 'loading' && (
          <p className="text-sm text-muted-foreground">One moment…</p>
        )}
        {status === 'invalid' && (
          <div className="space-y-4">
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Please sign in, or register again to get a new confirmation link.
            </p>
            <Link href="/login" className={buttonVariants({ className: 'w-full' })}>
              Go to login
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
