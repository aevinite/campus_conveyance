'use client';
import { useRef, useState, useTransition } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { QrCode, X, Loader2 } from 'lucide-react';
import { getRidePassUrl } from '@/features/ride-pass/actions';
import { useModalFocusTrap } from '@/lib/use-modal-focus-trap';

/**
 * "Show QR" button for a confirmed booking. Opens a large QR of the rider's
 * pass link — scanning it with any phone camera opens /pass/<token>, which shows
 * the student's verification card (full contacts only for that bus's staff).
 * The link is fetched on first open, so pages don't pay for it on load.
 */
export function RidePassQr({
  bookingId,
  studentName,
  className = '',
}: {
  bookingId: string;
  studentName?: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  function show() {
    setOpen(true);
    if (url) return;
    setFailed(false);
    start(async () => {
      const u = await getRidePassUrl(bookingId).catch(() => null);
      if (u) setUrl(u);
      else setFailed(true);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={show}
        className={`inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold transition-colors hover:bg-muted ${className}`}
      >
        <QrCode className="size-4" /> Show QR pass
      </button>
      {open && (
        <PassModal onClose={() => setOpen(false)}>
          <div className="relative w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="absolute top-3 right-3 grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
            >
              <X className="size-4" />
            </button>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Ride pass</p>
            <p className="mt-1 text-lg font-bold tracking-tight">{studentName || 'Your QR pass'}</p>
            <div className="mx-auto mt-4 grid size-[248px] place-items-center rounded-xl bg-white p-3">
              {url ? (
                <QRCodeSVG value={url} size={224} includeMargin={false} />
              ) : failed ? (
                <p className="px-4 text-sm text-neutral-600">Couldn&apos;t load the QR pass. Try again.</p>
              ) : (
                <Loader2 className={`size-6 text-neutral-500 ${pending ? 'animate-spin' : ''}`} />
              )}
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Show this to your driver or campus staff. Scanning it shows your pass details.
            </p>
          </div>
        </PassModal>
      )}
    </>
  );
}

function PassModal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useModalFocusTrap(true, ref, onClose);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/50 px-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)] backdrop-blur-xs outline-none"
      role="dialog"
      aria-modal="true"
      aria-label="Ride pass QR code"
    >
      {children}
    </div>
  );
}
