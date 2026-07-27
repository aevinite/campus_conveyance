'use client';
import { useEffect, useState } from 'react';
import { BrandMark } from '@/components/brand';
import { cn } from '@/lib/utils';

/**
 * Full-screen animated brand loader shown while the app / site boots. It is
 * server-rendered into <body>, so it's on screen from the very first paint —
 * covering the blank gap while the native app's WebView loads the site and
 * React hydrates. Once the page has finished loading (with a short minimum so
 * the animation reads, and a hard cap so it can never trap the user), it fades
 * out and unmounts. Only shows on a full page load, not on client-side
 * navigations, since it mounts once at the app root.
 */
export function AppSplash() {
  const [hide, setHide] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    // Inside the native app the NATIVE splash (Capacitor) is already on screen
    // from the instant the icon was tapped — so it, not this web overlay, is the
    // loader the user sees immediately. Drop this web overlay (it's hidden behind
    // the native splash anyway) and hide the native splash the moment the page is
    // ready, sending the user straight to the loaded page.
    const isNativeApp =
      typeof navigator !== 'undefined' && navigator.userAgent.includes('CampusConveyanceApp');

    if (isNativeApp) {
      setGone(true);
      let done = false;
      const hideNative = () => {
        if (done) return;
        done = true;
        import('@capacitor/splash-screen')
          .then(({ SplashScreen }) => SplashScreen.hide({ fadeOutDuration: 250 }))
          .catch(() => {});
      };
      if (document.readyState === 'complete') hideNative();
      else window.addEventListener('load', hideNative, { once: true });
      // Safety net: never leave the user stuck on the splash if `load` never fires.
      const cap = window.setTimeout(hideNative, 10000);
      return () => {
        window.removeEventListener('load', hideNative);
        window.clearTimeout(cap);
      };
    }

    const MIN = 700; // keep the logo animation visible at least this long
    const MAX = 4000; // safety: never keep the user behind the splash longer
    const start = performance.now();
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      const wait = Math.max(0, MIN - (performance.now() - start));
      window.setTimeout(() => setHide(true), wait);
    };

    if (document.readyState === 'complete') {
      finish();
    } else {
      window.addEventListener('load', finish, { once: true });
    }
    const cap = window.setTimeout(finish, MAX);
    return () => {
      window.removeEventListener('load', finish);
      window.clearTimeout(cap);
    };
  }, []);

  // Remove from the DOM after the fade so it never intercepts taps.
  useEffect(() => {
    if (!hide) return;
    const t = window.setTimeout(() => setGone(true), 520);
    return () => window.clearTimeout(t);
  }, [hide]);

  if (gone) return null;

  return (
    <div
      className={cn('app-splash', hide && 'app-splash--hide')}
      role="status"
      aria-label="Loading Campus Conveyance"
    >
      <div className="app-splash__mark">
        <span className="app-splash__ring" aria-hidden />
        <BrandMark className="app-splash__logo" />
      </div>
      <span className="app-splash__word">
        Campus <span>Conveyance</span>
      </span>
    </div>
  );
}
