'use client';
import { useEffect } from 'react';
import { isNativeApp } from '@/lib/native-google-auth';

/**
 * Tags the <html> element with `is-app` when running inside the native app, so
 * CSS can apply app-only tweaks (e.g. a softer light-mode palette that's easier
 * on the eyes) without touching the website. The initial paint is hidden behind
 * the native splash, so there's no flash. No-op in a normal browser.
 */
export function AppClass() {
  useEffect(() => {
    if (isNativeApp()) document.documentElement.classList.add('is-app');
  }, []);
  return null;
}
