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
import { establishSessionFromUrl } from '@/features/auth/recovery-session';

type Status = 'loading' | 'invalid' | 'handoff';

export default function ConfirmPage() {
  const [status, setStatus] = useState<Status>('loading');
  const [webDest, setWebDest] = useState('/');

  // The email-confirmation link lands here with the new session in the URL
  // #hash (Supabase's implicit flow) — which only the browser can read. We
  // establish the session (writing the auth cookies), then either hand off to
  // the native app (if installed) or send the confirmed user to their web
  // dashboard.
  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { detectSessionInUrl: false } },
    );
    (async () => {
      try {
        const session = await establishSessionFromUrl(supabase);

        const role =
          roleFromClaims(session.user.app_metadata) ??
          roleFromClaims(session.user.user_metadata);
        // A freshly-confirmed agency is still PENDING admin approval — park them
        // on /agency/login?pending=1 (they use the web panel, not the app).
        if (role === 'AGENCY') {
          await supabase.auth.signOut();
          window.location.replace('/agency/login?pending=1');
          return;
        }

        const dest = dashboardFor(role);
        setWebDest(dest);

        // Try the native app first (it's Android-only, for students/parents),
        // carrying the session via the existing campusconveyance:// deep-link
        // channel. If the app isn't installed the page stays visible → fall back
        // to the web dashboard. On non-Android just go straight to web.
        const isAndroid = /Android/i.test(navigator.userAgent);
        if (!isAndroid) {
          window.location.replace(dest);
          return;
        }

        const deep =
          'campusconveyance://auth/confirm#access_token=' +
          encodeURIComponent(session.access_token) +
          '&refresh_token=' +
          encodeURIComponent(session.refresh_token);

        setStatus('handoff');
        const fallback = window.setTimeout(() => {
          if (document.visibilityState === 'visible') window.location.replace(dest);
        }, 1800);
        // If the app opened, the tab goes to the background → cancel the fallback
        // so we don't navigate the backgrounded browser.
        const onHide = () => {
          if (document.visibilityState === 'hidden') window.clearTimeout(fallback);
        };
        document.addEventListener('visibilitychange', onHide);
        // Trigger the app.
        window.location.href = deep;
      } catch {
        setStatus('invalid');
      }
    })();
  }, []);

  return (
    <Card className="w-full max-w-sm shadow-lg">
      <CardHeader>
        <CardTitle className="text-2xl">
          {status === 'invalid'
            ? 'Confirmation failed'
            : status === 'handoff'
              ? 'Opening the app…'
              : 'Confirming your email…'}
        </CardTitle>
        <CardDescription>
          {status === 'invalid'
            ? 'This confirmation link is invalid or has expired.'
            : status === 'handoff'
              ? 'Taking you into the Campus Conveyance app. If nothing happens, continue on the web.'
              : 'Signing you in and taking you to your dashboard.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {status === 'loading' && (
          <p className="text-sm text-muted-foreground">One moment…</p>
        )}
        {status === 'handoff' && (
          <Link href={webDest} className={buttonVariants({ variant: 'outline', className: 'w-full' })}>
            Continue on the web
          </Link>
        )}
        {status === 'invalid' && (
          <div className="space-y-4">
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
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
