'use client';
import { useEffect } from 'react';
import { isNativeApp, NATIVE_OAUTH_PENDING_KEY } from '@/lib/native-google-auth';

/**
 * Finishes an auth flow that returns to the app via the `campusconveyance://auth`
 * deep link:
 *  - Google sign-in — Supabase redirects to `…/auth/callback?code=…`; we exchange
 *    the PKCE code for a session (the verifier is in this WebView's storage).
 *    Only honoured while a sign-in THIS app started is pending, so a web page
 *    firing the link can't log the app into someone else's account (and a
 *    stolen code is useless without this WebView's PKCE verifier).
 *  - Email confirmation — the web /confirm page opens `…/auth/confirm` with NO
 *    tokens (another app could register the scheme and catch them); we just
 *    open the login screen with an "email confirmed" note.
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

      // A cold start can deliver the SAME deep link through both getLaunchUrl and
      // the appUrlOpen listener. Guard so a one-time PKCE code is never exchanged
      // twice (the second exchange fails on a consumed code and would bounce the
      // user to /login?error).
      //
      // getLaunchUrl keeps returning the launch link for the whole app session,
      // and every handled link ends in a full-page navigation that remounts this
      // component — so the "handled" set must survive navigations (sessionStorage),
      // or a cold-start link is re-processed on every load → endless reload loop.
      const KEY = 'cc:handled-auth-links';
      const readHandled = (): string[] => {
        try {
          const v = JSON.parse(sessionStorage.getItem(KEY) ?? '[]');
          return Array.isArray(v) ? v : [];
        } catch {
          return [];
        }
      };
      const handled = new Set<string>(readHandled());
      const markHandled = (url: string) => {
        handled.add(url);
        try {
          sessionStorage.setItem(KEY, JSON.stringify([...handled].slice(-10)));
        } catch {
          /* storage unavailable — the in-memory set still guards this page */
        }
      };

      const handleUrl = async (url: string) => {
        if (!url || !url.startsWith('campusconveyance://auth')) return;
        if (handled.has(url)) return;
        markHandled(url);
        await Browser.close().catch(() => {});
        try {
          // Parse the custom-scheme URL by hand — new URL()'s hash handling is
          // unreliable for non-http schemes across engines.
          const hIdx = url.indexOf('#');
          const qIdx = url.indexOf('?');
          const query = new URLSearchParams(
            qIdx >= 0 ? url.slice(qIdx + 1, hIdx >= 0 && hIdx > qIdx ? hIdx : undefined) : '',
          );

          const err = query.get('error_description') ?? query.get('error');
          if (err) {
            window.location.assign(`/login?error=${encodeURIComponent(err)}`);
            return;
          }

          const supabase = createClient();
          const code = query.get('code');

          if (url.startsWith('campusconveyance://auth/confirm')) {
            window.location.assign('/login?confirmed=1');
            return;
          }
          if (!code) return; // nothing actionable

          // Only finish a Google sign-in this app started in the last 15 minutes.
          let startedAt = 0;
          try {
            startedAt = Number(localStorage.getItem(NATIVE_OAUTH_PENDING_KEY) ?? 0);
            localStorage.removeItem(NATIVE_OAUTH_PENDING_KEY);
          } catch {
            /* storage unavailable → treated as not started */
          }
          if (!startedAt || Date.now() - startedAt > 15 * 60 * 1000) return;

          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          // A brand-new Google signup's first token can predate the role claim
          // (the access-token hook derives it from the freshly-created profile).
          // Refresh once so the cookie the proxy reads carries the role — mirrors
          // the web /auth/callback. Best-effort: the proxy also falls back to a
          // sensible dashboard for a still-roleless session.
          await supabase.auth.refreshSession().catch(() => {});
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
