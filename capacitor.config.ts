import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config — wraps the live site in a standalone native Android app
 * (its own Android System WebView, NOT Chrome: no address bar, its own icon in
 * the launcher). `server.url` points at the deployed site, so login and every
 * action still hit the same Supabase backend automatically.
 *
 * `webDir` (capacitor-www) is a tiny placeholder shell Capacitor requires; at
 * runtime the app loads `server.url` instead.
 */
const config: CapacitorConfig = {
  appId: 'com.aevinite.campusconveyance',
  appName: 'Campus Conveyance',
  webDir: 'capacitor-www',
  server: {
    url: 'https://campus-conveyance.vercel.app',
    cleartext: false,
  },
  android: {
    backgroundColor: '#1c1917',
    // Marker appended to the WebView User-Agent so the site can tell it is being
    // viewed inside the native app (vs a browser) and render the app-specific
    // view — bottom tab bar, no marketing landing, User/Agency login chooser.
    // Kept in sync with APP_UA_MARKER in src/lib/app-context.ts.
    appendUserAgent: 'CampusConveyanceApp',
  },
};

export default config;
