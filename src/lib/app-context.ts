import { headers } from 'next/headers';

/**
 * Token the native app appends to its WebView User-Agent (see
 * capacitor.config.ts `android.appendUserAgent`). Its presence is how the site
 * distinguishes "opened inside the Campus Conveyance app" from "opened in a
 * browser", so it can render the app-specific view (bottom tab bar, no
 * marketing landing, User/Agency login chooser).
 */
export const APP_UA_MARKER = 'CampusConveyanceApp';

/** True when the current request comes from inside the native app. Server-only. */
export async function isAppRequest(): Promise<boolean> {
  const ua = (await headers()).get('user-agent') ?? '';
  return ua.includes(APP_UA_MARKER);
}
