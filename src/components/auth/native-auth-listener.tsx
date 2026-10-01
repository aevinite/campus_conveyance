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

      // Dedupe rules (issue #4):
      //  - getLaunchUrl keeps returning the SAME launch link for the whole app
      //    session, and every handled link ends in a full-page navigation that
      //    remounts this component — so the launch link is processed at most once
      //    per session (sessionStorage), or a cold start would reload forever.
      //  - appUrlOpen events are NOT deduped session-wide: the email-confirm link
      //    is always the identical tokenless URL, so a second/third tap must still
      //    open the login screen. We only drop an exact repeat within a few
      //    seconds (a cold start can deliver one link through BOTH paths), and a
      //    one-time PKCE code is never exchanged twice.
      const LAUNCH_KEY = 'cc:handled-launch-url';
      const RECENT_KEY = 'cc:recent-auth-links';
      const CODES_KEY = 'cc:used-auth-codes';
      const REPEAT_WINDOW_MS = 5000;
      const readJson = <T,>(key: string, fallback: T): T => {
        try {
          const v = JSON.parse(sessionStorage.getItem(key) ?? 'null');
          return v ?? fallback;
        } catch {
          return fallback;
        }
      };
      const writeJson = (key: string, value: unknown) => {
        try {
          sessionStorage.setItem(key, JSON.stringify(value));
        } catch {
          /* storage unavailable — in-memory state still guards this page */
        }
      };
      let launchUrl: string | null = null;
      const recent: Record<string, number> = readJson(RECENT_KEY, {});
      const usedCodes: string[] = readJson(CODES_KEY, []);
      /** True when this exact link was just handled (cold-start double delivery). */
      const isRepeat = (url: string) => {
        const at = recent[url];
        return typeof at === 'number' && Date.now() - at < REPEAT_WINDOW_MS;
      };
      const markHandled = (url: string) => {
        const now = Date.now();
        recent[url] = now;
        for (const [k, t] of Object.entries(recent)) {
          if (now - t > REPEAT_WINDOW_MS * 4) delete recent[k];
        }
        writeJson(RECENT_KEY, recent);
        if (launchUrl && url === launchUrl) writeJson(LAUNCH_KEY, url);
      };

      const handleUrl = async (url: string) => {
        if (!url || !url.startsWith('campusconveyance://auth')) return;
        if (isRepeat(url)) return;
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
          if (usedCodes.includes(code)) return; // one-time code already exchanged
          usedCodes.push(code);
          writeJson(CODES_KEY, usedCodes.slice(-10));

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

      // Cold start: the app may have been launched BY the deep link. Process the
      // launch link only once per app session (it is replayed on every mount).
      try {
        const launch = await App.getLaunchUrl();
        if (launch?.url) {
          launchUrl = launch.url;
          if (readJson<string | null>(LAUNCH_KEY, null) !== launch.url) {
            await handleUrl(launch.url);
          }
        }
      } catch {
        // no launch URL / not supported — ignore.
      }

      // Warm opens: every tap is handled (only an immediate duplicate is dropped).
      const handle = await App.addListener('appUrlOpen', ({ url }) => {
        void handleUrl(url);
      });
      remove = () => handle.remove();
    })();

    return () => remove?.();
  }, []);

  return null;
}
