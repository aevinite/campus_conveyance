'use client';
import { useEffect, useState, useTransition } from 'react';
import { BellRing, BellOff } from 'lucide-react';
import {
  savePushSubscriptionAction,
  removePushSubscriptionAction,
} from '@/features/notifications/actions';
import { cn } from '@/lib/utils';

/**
 * Header control to enable / disable browser push notifications for booking
 * updates. Progressive-enhancement: renders nothing if the browser can't do
 * Web Push (older Safari, some in-app webviews) or if no VAPID key is set.
 *
 * Push complements — never replaces — the in-app bell + email, which always
 * fire. Enabling requires a user gesture (browsers block silent permission
 * prompts), so this is a click-to-enable button, not an auto-prompt.
 */

// VAPID public keys are URL-safe base64; the PushManager wants a Uint8Array
// backed by a plain ArrayBuffer (not ArrayBufferLike) to satisfy BufferSource.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export function PushToggle() {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ok =
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window &&
      !!VAPID_PUBLIC;
    setSupported(ok);
    if (!ok) return;

    // Register the worker and reflect the current subscription state. If already
    // subscribed, refresh the stored row so retention keeps it alive.
    (async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        const sub = await reg.pushManager.getSubscription();
        if (sub && Notification.permission === 'granted') {
          setEnabled(true);
          void savePushSubscriptionAction(sub.toJSON());
        }
      } catch {
        /* registration failed — leave disabled, button will retry on click */
      }
    })();
  }, []);

  async function enable() {
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setError(
          permission === 'denied'
            ? 'Notifications are blocked in your browser settings.'
            : 'Permission was dismissed.',
        );
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC as string),
      });
      startTransition(async () => {
        const res = await savePushSubscriptionAction(sub.toJSON());
        if (res.error) {
          setError(res.error);
          await sub.unsubscribe().catch(() => {});
        } else {
          setEnabled(true);
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not enable notifications.');
    }
  }

  async function disable() {
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      const endpoint = sub?.endpoint;
      await sub?.unsubscribe().catch(() => {});
      startTransition(async () => {
        if (endpoint) await removePushSubscriptionAction(endpoint);
        setEnabled(false);
      });
    } catch {
      setEnabled(false);
    }
  }

  if (!supported) return null;

  return (
    <button
      type="button"
      disabled={pending}
      onClick={enabled ? disable : enable}
      title={
        error ??
        (enabled
          ? 'Push notifications on — click to turn off'
          : 'Get booking updates as browser notifications')
      }
      aria-label={enabled ? 'Disable push notifications' : 'Enable push notifications'}
      className={cn(
        'relative grid size-9 place-items-center rounded-full border border-border bg-background/60 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60',
        enabled && 'text-primary',
      )}
    >
      {enabled ? <BellRing className="size-4" /> : <BellOff className="size-4" />}
    </button>
  );
}
