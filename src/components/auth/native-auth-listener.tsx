'use client';
import { useEffect } from 'react';
import { isNativeApp } from '@/lib/native-google-auth';

/**
 * Finishes an auth flow that returns to the app via the `campusconveyance://auth`
 * deep link:
 *  - Google sign-in — Supabase redirects to `…/auth/callback?code=…`; we exchange
 *    the PKCE code for a session (the verifier is in this WebView's storage).
 *  - Email confirmation — the web /confirm page hands off to
 *    `…/auth/confirm#access_token=…&refresh_token=…`; we set the session from
 *    those tokens so a signup started in the app finishes in the app.
 *
 * Handles both a warm open (appUrlOpen) and a cold start (getLaunchUrl). No-op in
 * a normal browser — the @capacitor/* modules load only inside the native app.
 */
export function NativeAuthListener() {
  useEffect(() => {
    if (!isNativeApp()) return;
    let remove: (() => void) | undefined;

    (async () => {
      const { App } = await import('@capacitor/app');
      const { Browser } = await import('@capacitor/browser');
      const { createClient } = await import('@/lib/supabase/client');

      const handleUrl = async (url: string) => {
        if (!url || !url.startsWith('campusconveyance://auth')) return;
        await Browser.close().catch(() => {});
        try {
          // Parse the custom-scheme URL by hand — new URL()'s hash handling is
          // unreliable for non-http schemes across engines.
          const hIdx = url.indexOf('#');
          const qIdx = url.indexOf('?');
          const query = new URLSearchParams(
            qIdx >= 0 ? url.slice(qIdx + 1, hIdx >= 0 && hIdx > qIdx ? hIdx : undefined) : '',
          );
          const hash = new URLSearchParams(hIdx >= 0 ? url.slice(hIdx + 1) : '');

          const err = query.get('error_description') ?? query.get('error');
          if (err) {
            window.location.assign(`/login?error=${encodeURIComponent(err)}`);
            return;
          }

          const supabase = createClient();
          const code = query.get('code');
          const accessToken = hash.get('access_token');
          const refreshToken = hash.get('refresh_token');

          if (code) {
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (error) throw error;
          } else if (accessToken && refreshToken) {
            const { error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (error) throw error;
          } else {
            return; // nothing actionable
          }
          // Full navigation so the SSR layer reads the fresh session cookies and
          // routes the user to the right dashboard.
          window.location.assign('/');
        } catch {
          window.location.assign(
            `/login?error=${encodeURIComponent('Sign-in could not be completed. Please try again.')}`,
          );
        }
      };

      // Cold start: the app may have been launched BY the deep link.
      try {
        const launch = await App.getLaunchUrl();
        if (launch?.url) await handleUrl(launch.url);
      } catch {
        // no launch URL / not supported — ignore.
      }

      const handle = await App.addListener('appUrlOpen', ({ url }) => {
        void handleUrl(url);
      });
      remove = () => handle.remove();
    })();

    return () => remove?.();
  }, []);

  return null;
}
