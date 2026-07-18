'use client';
import { useActionState, useEffect, useState } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';
import { Eye, EyeOff } from 'lucide-react';
import { resetAction, type AuthState } from '@/features/auth/actions';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

type LinkStatus = 'loading' | 'ready' | 'invalid';

export default function ResetPage() {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    resetAction,
    {},
  );
  const [status, setStatus] = useState<LinkStatus>('loading');
  const [showPassword, setShowPassword] = useState(false);

  // Supabase sends the recovery session in the URL. Depending on the flow it
  // arrives either as a #hash fragment (implicit) or a ?code= param (PKCE);
  // both can only be read in the browser. We establish the session here so the
  // resetAction (server) can update the password via the session cookie.
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

        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
        } else if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else {
          const { data } = await supabase.auth.getSession();
          if (!data.session) throw new Error('missing recovery session');
        }
        // Strip the token from the address bar so it can't be reused/leaked.
        window.history.replaceState(null, '', '/reset');
        setStatus('ready');
      } catch {
        setStatus('invalid');
      }
    })();
  }, []);

  return (
    <Card className="w-full max-w-sm shadow-lg">
      <CardHeader>
        <CardTitle className="text-xl">Choose a new password</CardTitle>
        <CardDescription>
          {status === 'invalid'
            ? 'This reset link is invalid or has expired.'
            : 'Use at least 8 characters.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {status === 'loading' && (
          <p className="text-sm text-muted-foreground">Verifying your link…</p>
        )}

        {status === 'invalid' && (
          <div className="space-y-4">
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Please request a new reset link — this one is no longer valid.
            </p>
            <Link href="/forgot" className={buttonVariants({ className: 'w-full' })}>
              Request a new link
            </Link>
          </div>
        )}

        {status === 'ready' && (
          <form action={action} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  minLength={8}
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            </div>
            {state.error && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {state.error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? 'Updating…' : 'Update password'}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
