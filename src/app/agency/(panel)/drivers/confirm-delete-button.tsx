'use client';
import { useId, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/submit-button';
import { useModalFocusTrap } from '@/lib/use-modal-focus-trap';

/**
 * A destructive action that asks for confirmation first: the trigger button just
 * opens a modal, and only the modal's confirm button actually submits the given
 * server action. Used for deleting a driver (soft) and deleting permanently (hard).
 */
export function ConfirmDeleteButton({
  action,
  driverId,
  trigger,
  title,
  message,
  confirmLabel,
  pendingText,
}: {
  action: (formData: FormData) => void | Promise<void>;
  driverId: string;
  trigger: string;
  title: string;
  message: string;
  confirmLabel: string;
  pendingText: string;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useModalFocusTrap(open, dialogRef, () => setOpen(false));
  return (
    <>
      <Button type="button" variant="destructive" size="sm" onClick={() => setOpen(true)}>
        {trigger}
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-xs"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            tabIndex={-1}
            className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl outline-none"
          >
            <div className="flex items-start justify-between">
              <span className="grid size-11 place-items-center rounded-2xl bg-destructive/10 text-destructive">
                <AlertTriangle className="size-6" />
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>
            <h2 id={titleId} className="mt-4 text-lg font-bold">{title}</h2>
            <p id={descId} className="mt-1 text-sm text-muted-foreground">{message}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <form action={action}>
                <input type="hidden" name="driverId" value={driverId} />
                <SubmitButton variant="destructive" size="sm" pendingText={pendingText}>
                  {confirmLabel}
                </SubmitButton>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
