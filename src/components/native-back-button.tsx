'use client';
import { useEffect } from 'react';
import { isNativeApp } from '@/lib/native-google-auth';

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
    let remove: (() => void) | undefined;

    (async () => {
      const { App } = await import('@capacitor/app');
      const handle = await App.addListener('backButton', ({ canGoBack }) => {
        // Prefer stepping back through history (instant, client-side). Fall back
        // to history.length in case Capacitor's canGoBack lags SPA navigations.
        if (canGoBack || window.history.length > 1) {
          window.history.back();
        } else {
          // At the root screen with nothing behind us — let back exit as usual.
          App.exitApp();
        }
      });
      remove = () => handle.remove();
    })();

    return () => remove?.();
  }, []);

  return null;
}
