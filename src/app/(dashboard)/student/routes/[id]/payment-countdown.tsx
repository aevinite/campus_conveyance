'use client';
import { useEffect, useRef, useState } from 'react';
import { Clock3 } from 'lucide-react';

function secondsLeft(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
}

/**
 * Live payment-window countdown. Ticks down to `expiresAt` once a second and
 * fires `onExpire` when it hits zero — so the student gets moving feedback and
 * the panel flips to the "expired" state on its own, instead of a static label
 * that only reveals it's too late when a pay attempt fails.
 */
export function PaymentCountdown({
  expiresAt,
  onExpire,
}: {
  expiresAt: string | null;
  onExpire?: () => void;
}) {
  const [left, setLeft] = useState(() => secondsLeft(expiresAt));
  // Keep onExpire in a ref so an inline (re-created) callback prop doesn't
  // re-run the effect and rebuild the 1s interval on every parent re-render.
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  });

  useEffect(() => {
    if (!expiresAt) return;
    setLeft(secondsLeft(expiresAt));
    const id = setInterval(() => {
      const s = secondsLeft(expiresAt);
      setLeft(s);
      if (s <= 0) {
        clearInterval(id);
        onExpireRef.current?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (!expiresAt) return null;

  const mm = Math.floor(left / 60);
  const ss = left % 60;
  const urgent = left <= 120; // last 2 minutes
  return (
    <div
      className={`mt-3 flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm ${
        left <= 0
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : urgent
            ? 'border-warning/40 bg-warning/10 text-warning'
            : 'border-border bg-muted/40 text-muted-foreground'
      }`}
      aria-live="polite"
    >
      <Clock3 className="size-4 shrink-0" />
      {left <= 0 ? (
        <span className="font-medium">Payment window expired</span>
      ) : (
        <span>
          Time left to pay:{' '}
          <span className="font-mono font-semibold tabular-nums">
            {mm}:{String(ss).padStart(2, '0')}
          </span>
        </span>
      )}
    </div>
  );
}
