'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Keeps a panel live: periodically re-fetches the current route's server data via
 * router.refresh(), so new bookings/payments/rides show up without a manual
 * reload. Client component state (open dialogs, map, inputs) is preserved across
 * a refresh. Pauses while the tab is hidden (no wasted work / battery), and does
 * one refresh the moment the tab becomes visible again.
 */
export function AutoRefresh({ seconds = 20 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const id = window.setInterval(tick, Math.max(5, seconds) * 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [router, seconds]);
  return null;
}
