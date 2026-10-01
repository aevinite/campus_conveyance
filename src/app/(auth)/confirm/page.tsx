'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';
import type { EmailOtpType } from '@supabase/supabase-js';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { dashboardFor, roleFromClaims } from '@/lib/rbac/roles';

type Status = 'loading' | 'invalid' | 'confirmed' | 'ready' | 'handoff';

const OTP_TYPES: EmailOtpType[] = ['signup', 'email'];

/**
 * Email-confirmation landing page (audit #25).
 *
 * The confirmation email links here with a single-use `?token_hash=…&type=signup`
 * which we redeem with verifyOtp(). We NEVER call setSession() with tokens found
 * in the URL: a link carrying someone else's access/refresh tokens would silently
 * sign the visitor into that account. After a successful verify we show WHICH
 * account was confirmed and let the visitor continue — or sign out if it isn't
 * theirs — instead of routing them in silently.
 *
 * Legacy links (Supabase's action_link → `/confirm#access_token=…`) were already
 * verified by Supabase before redirecting here, so we just say "confirmed — sign
 * in" without touching the tokens.
 */
export default function ConfirmPage() {
  const [status, setStatus] = useState<Status>('loading');
  const [email, setEmail] = useState<string | null>(null);
  const [webDest, setWebDest] = useState('/');
  const clientRef = useRef<ReturnType<typeof createBrowserClient> | null>(null);

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { detectSessionInUrl: false } },
    );
    clientRef.current = supabase;
    (async () => {
      const url = new URL(window.location.href);
      const tokenHash = url.searchParams.get('token_hash');
      const typeParam = url.searchParams.get('type') as EmailOtpType | null;
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      // Drop the one-time material from the address bar (and history) right away.
      window.history.replaceState(null, '', '/confirm');

      if (!tokenHash) {
        // Legacy Supabase-hosted link: the email was confirmed before the
        // redirect. Do not adopt the session tokens — ask the user to sign in.
        if (hash.get('access_token') && !hash.get('error')) {
          setStatus('confirmed');
        } else {
          setStatus('invalid');
        }
        return;
      }

      try {
        const type = typeParam && OTP_TYPES.includes(typeParam) ? typeParam : 'signup';
        const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
        if (error || !data.session) throw error ?? new Error('missing session');
        const user = data.session.user;

        const role =
          roleFromClaims(user.app_metadata) ?? roleFromClaims(user.user_metadata);
        // A freshly-confirmed agency is still PENDING admin approval — park them
        // on /agency/login?pending=1 (they use the web panel, not the app).
        if (role === 'AGENCY') {
          await supabase.auth.signOut();
          window.location.replace('/agency/login?pending=1');
          return;
        }
        setWebDest(dashboardFor(role));
        setEmail(user.email ?? null);
        setStatus('ready');
      } catch {
        setStatus('invalid');
      }
    })();
  }, []);

  function onContinue() {
    // Try the native app first (Android-only, for students/parents). The deep
    // link carries NO session tokens: any other app can register the same
    // custom scheme and would catch them. The app just opens its login screen
    // ("email confirmed — sign in"). If the app isn't installed the page stays
    // visible → fall back to the web dashboard (this browser is signed in).
    const isAndroid = /Android/i.test(navigator.userAgent);
    if (!isAndroid) {
      window.location.replace(webDest);
      return;
    }
    setStatus('handoff');
    const fallback = window.setTimeout(() => {
      if (document.visibilityState === 'visible') window.location.replace(webDest);
    }, 1800);
    const onHide = () => {
      if (document.visibilityState === 'hidden') window.clearTimeout(fallback);
    };
    document.addEventListener('visibilitychange', onHide);
    window.location.href = 'campusconveyance://auth/confirm';
  }

  async function onNotMe() {
    await clientRef.current?.auth.signOut().catch(() => {});
    window.location.replace('/login');
  }

  const title =
    status === 'invalid'
      ? 'Confirmation failed'
      : status === 'handoff'
        ? 'Opening the app…'
        : status === 'ready' || status === 'confirmed'
          ? 'Email confirmed'
          : 'Confirming your email…';
  const description =
    status === 'invalid'
      ? 'This confirmation link is invalid or has expired.'
      : status === 'handoff'
        ? 'Taking you into the Campus Conveyance app. If nothing happens, continue on the web.'
        : status === 'ready'
          ? 'Your account is confirmed and you are now signed in.'
          : status === 'confirmed'
            ? 'Your email is confirmed — sign in to continue.'
            : 'One moment while we confirm your email.';

  return (
    <Card className="w-full max-w-sm shadow-lg">
      <CardHeader>
        <CardTitle className="text-2xl">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {status === 'loading' && (
          <p className="text-sm text-muted-foreground">One moment…</p>
        )}
        {status === 'ready' && (
          <div className="space-y-4">
            <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
              Signed in as <span className="font-semibold break-all">{email ?? 'your account'}</span>
            </p>
            <Button className="w-full" onClick={onContinue}>
              Continue as {email ?? 'this account'}
            </Button>
            <Button variant="outline" className="w-full" onClick={onNotMe}>
              Not you? Sign out
            </Button>
          </div>
        )}
        {status === 'confirmed' && (
          <Link href="/login?confirmed=1" className={buttonVariants({ className: 'w-full' })}>
            Sign in
          </Link>
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
