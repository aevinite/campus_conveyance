'use client';
import { useId, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/submit-button';
import { useModalFocusTrap } from '@/lib/use-modal-focus-trap';

type ButtonVariant = ComponentProps<typeof Button>['variant'];

/**
 * A destructive/confirmable action rendered as a server-action <form>. Clicking
 * the trigger opens a modal ("Are you sure?") with Cancel + confirm buttons; the
 * confirm button actually submits the form, so the server action only runs after
 * the admin confirms. Closes on Cancel, backdrop click, or Escape.
 */
export function ConfirmSubmit({
  action,
  fields,
  triggerLabel,
  triggerVariant = 'destructive',
  title,
  description,
  confirmLabel,
  confirmVariant = 'destructive',
  pendingText,
}: {
  action: (formData: FormData) => void | Promise<void>;
  fields: Record<string, string>;
  triggerLabel: string;
  triggerVariant?: ButtonVariant;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  pendingText: string;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useModalFocusTrap(open, dialogRef, () => setOpen(false));

  return (
    <form action={action}>
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Button
        type="button"
        variant={triggerVariant}
        size="sm"
        onClick={() => setOpen(true)}
      >
        {triggerLabel}
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          // onMouseDown + target check: a text-selection drag that ends over the
          // backdrop shouldn't dismiss the dialog.
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            tabIndex={-1}
            className="w-full max-w-sm rounded-xl border border-border bg-background p-5 shadow-lg outline-none"
          >
            <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
            <p id={descId} className="mt-1.5 text-sm text-muted-foreground">{description}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <SubmitButton variant={confirmVariant} size="sm" pendingText={pendingText}>
                {confirmLabel}
              </SubmitButton>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
