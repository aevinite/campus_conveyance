'use client';
import { useFormStatus } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ComponentProps } from 'react';

/**
 * A submit button that reads the enclosing <form>'s pending state via
 * useFormStatus. While the server action is in flight it disables itself and
 * shows a spinner, so a click gives instant feedback instead of feeling frozen.
 * Drop-in replacement for <Button type="submit"> inside a server-action form.
 */
export function SubmitButton({
  children,
  pendingText,
  ...props
}: ComponentProps<typeof Button> & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} {...props}>
      {pending && <Loader2 className="size-3.5 animate-spin" />}
      {pending ? (pendingText ?? children) : children}
    </Button>
  );
}
