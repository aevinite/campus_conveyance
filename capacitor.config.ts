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
    // Light warm-white (matches the web --background). The app opens in light
    // mode by default, so the native launch surface is light too — no dark→light
    // flash before the WebView paints.
    backgroundColor: '#fbfaf6',
    // Marker appended to the WebView User-Agent so the site can tell it is being
    // viewed inside the native app (vs a browser) and render the app-specific
    // view — bottom tab bar, no marketing landing, User/Agency login chooser.
    // Kept in sync with APP_UA_MARKER in src/lib/app-context.ts.
    appendUserAgent: 'CampusConveyanceApp',
  },
  plugins: {
    // Native splash shows the INSTANT the icon is tapped (it's part of the APK,
    // no network), covering the gap while the WebView fetches the remote site.
    // We don't auto-hide it on a timer — the web app calls SplashScreen.hide()
    // the moment its own UI has painted (see components/app-splash.tsx), so the
    // loader is on screen immediately on open and disappears exactly when the
    // page is ready. On a warm resume of an already-loaded app it doesn't show.
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: false,
      backgroundColor: '#fbfaf6',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashImmersive: false,
    },
  },
};

export default config;
