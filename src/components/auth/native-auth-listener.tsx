'use client';
import { useEffect } from 'react';
import { isNativeApp } from '@/lib/native-google-auth';

/**
 * Finishes the app's Google sign-in. After the user authenticates in the system
 * browser, Supabase redirects to the `campusconveyance://auth/callback` deep link;
 * Android hands that back to the app (singleTask) and fires `appUrlOpen`. We grab
 * the auth `code`, close the browser, exchange it for a session (the PKCE verifier
 * is still in this WebView's storage from when we started the flow), then reload
 * so the server picks up the new auth cookies and routes by role.
 *
 * No-op in a normal browser — the @capacitor/* modules are only imported when
 * actually running inside the native app.
 */
export function NativeAuthListener() {
  useEffect(() => {
    if (!isNativeApp()) return;
    let remove: (() => void) | undefined;

    (async () => {
      const { App } = await import('@capacitor/app');
      const { Browser } = await import('@capacitor/browser');
      const { createClient } = await import('@/lib/supabase/client');

      const handle = await App.addListener('appUrlOpen', async ({ url }) => {
        if (!url.startsWith('campusconveyance://auth')) return;
        await Browser.close().catch(() => {});
        try {
          const parsed = new URL(url);
          const err = parsed.searchParams.get('error_description') ?? parsed.searchParams.get('error');
          if (err) {
            window.location.assign(`/login?error=${encodeURIComponent(err)}`);
            return;
          }
          const code = parsed.searchParams.get('code');
          if (!code) return;
          const { error } = await createClient().auth.exchangeCodeForSession(code);
          if (error) {
            window.location.assign(
              `/login?error=${encodeURIComponent('Sign-in could not be completed. Please try again.')}`,
            );
            return;
          }
          // Full navigation (not client routing) so the SSR layer reads the fresh
          // session cookies and sends the user to the right dashboard.
          window.location.assign('/');
        } catch {
          window.location.assign(`/login?error=${encodeURIComponent('Google sign-in failed.')}`);
        }
      });
      remove = () => handle.remove();
    })();

    return () => remove?.();
  }, []);

  return null;
}
