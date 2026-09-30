'use client';
import { useEffect } from 'react';
import { isNativeApp } from '@/lib/native-google-auth';

// ONE app-wide registration, shared across mounts. The listener is added
// asynchronously (lazy import + addListener promise), so a per-mount "remove"
// captured after the await leaked whenever the component unmounted before the
// promise settled (StrictMode double-mount, layout remount) — leaving either a
// duplicate listener (back = two pages) or none at all (back dead). A module-level
// ref-count + single in-flight registration makes it register exactly once and be
// removed only when the last mount goes away.
let mounts = 0;
let registration: Promise<{ remove: () => Promise<void> } | null> | null = null;

function register() {
  registration ??= (async () => {
    try {
      const { App } = await import('@capacitor/app');
      return await App.addListener('backButton', ({ canGoBack }) => {
        try {
          // Prefer stepping back through history (instant, client-side). Fall
          // back to history.length in case Capacitor's canGoBack lags SPA navs.
          if (canGoBack || window.history.length > 1) {
            window.history.back();
          } else {
            // At the root screen with nothing behind us — let back exit as usual.
            void App.exitApp();
          }
        } catch {
          // Never leave back dead: best-effort history step.
          window.history.back();
        }
      });
    } catch {
      registration = null; // plugin unavailable — allow a retry on next mount
      return null;
    }
  })();
  return registration;
}

/**
 * Makes the Android hardware / gesture back button behave like a real app:
 * it steps ONE page back through history instead of instantly quitting.
 *
 * Capacitor's default `backButton` behaviour on Android exits the app, which is
 * why "back" was dropping users straight out. We register our own listener so
 * back walks the WebView/Next history (client-side, so it's instant); only when
 * there's nowhere left to go (the app's root screen) do we exit.
 *
 * No-op outside the native app — `@capacitor/app` is imported lazily and only
 * when actually running inside the app.
 */
export function NativeBackButton() {
  useEffect(() => {
    if (!isNativeApp()) return;
    mounts++;
    void register();
    return () => {
      mounts--;
      if (mounts > 0) return;
      const pending = registration;
      // Remove once the (possibly still in-flight) registration settles — unless
      // a new mount arrived in the meantime (it reused `registration`, so keep it).
      void pending?.then((h) => {
        if (mounts > 0 || registration !== pending) return;
        registration = null;
        void h?.remove();
      });
    };
  }, []);

  return null;
}
