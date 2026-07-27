'use client';
import { useEffect } from 'react';

/**
 * Registers the service worker on every page so the site is installable as an
 * app (a registered SW + manifest is what makes Chrome offer "Install" and what
 * the packaged APK relies on). The worker itself only handles Web Push — it does
 * no caching, so it never interferes with the app's network requests.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* registration failed — push + install just stay unavailable */
    });
  }, []);
  return null;
}
