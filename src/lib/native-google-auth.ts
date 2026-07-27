// Google sign-in for the native (Capacitor) app.
//
// Google refuses OAuth inside an app's embedded WebView ("disallowed_useragent"),
// so we can't just navigate the WebView to the Google consent page like the
// website does. Instead we open the consent flow in the phone's REAL browser
// (a Chrome Custom Tab via @capacitor/browser) — which Google allows — and then
// deep-link back into the app with the auth code. The listener that catches the
// deep link and finishes the session lives in components/auth/native-auth-listener.
//
// This reuses the SAME Supabase Web client id already configured, so it needs no
// Android OAuth client / SHA-1. The redirect target is a custom scheme registered
// in AndroidManifest.xml and allow-listed in Supabase.
import { createClient } from '@/lib/supabase/client';

/** Deep link Supabase sends the browser back to; caught by the native listener. */
export const NATIVE_OAUTH_REDIRECT = 'campusconveyance://auth/callback';

/** True when running inside the Campus Conveyance native app. Uses the same
 *  User-Agent marker the server checks (see src/lib/app-context.ts), so it needs
 *  no Capacitor import and is safe to call during SSR (returns false there). */
export function isNativeApp(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('CampusConveyanceApp');
}

/** Kick off Google sign-in from inside the app: ask Supabase for the consent URL
 *  (without redirecting the WebView), then open it in the system browser. */
export async function nativeGoogleSignIn(): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: NATIVE_OAUTH_REDIRECT,
      // Don't navigate the WebView — we hand the URL to the system browser.
      skipBrowserRedirect: true,
    },
  });
  if (error) throw error;
  if (!data?.url) throw new Error('Could not start Google sign-in.');
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url: data.url });
}
