'use client';
import { useState } from 'react';
import { CheckCircle2, Send, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { submitContactAction } from '@/features/contact/actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

/**
 * "Message our team" form on the Help & Support page — reuses the same
 * submitContactAction the public landing uses (stores in contact_messages +
 * emails the platform inbox). Name/email are prefilled from the signed-in
 * profile but stay editable.
 */
export function SupportContactForm({
  defaultName = '',
  defaultEmail = '',
}: {
  defaultName?: string;
  defaultEmail?: string;
}) {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setPending(true);
    const res = await submitContactAction({
      name: String(fd.get('name') ?? '').trim(),
      email: String(fd.get('email') ?? '').trim(),
      phone: String(fd.get('phone') ?? '').trim(),
      message: String(fd.get('message') ?? '').trim(),
    });
    setPending(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    setSent(true);
    toast.success('Message sent — we’ll get back to you.');
  }

  if (sent) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
        <span>Thanks — your message is on its way. Our team will reply to your email shortly.</span>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Your name</Label>
          <Input id="name" name="name" defaultValue={defaultName} required minLength={2} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" defaultValue={defaultEmail} required />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="phone">Phone (optional)</Label>
        <Input id="phone" name="phone" type="tel" placeholder="e.g. +91 90000 00000" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="message">How can we help?</Label>
        <Textarea id="message" name="message" required minLength={5} rows={4} placeholder="Describe your question or issue…" />
      </div>
      <Button type="submit" disabled={pending} className="gap-2">
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Sending…
          </>
        ) : (
          <>
            <Send className="size-4" /> Send message
          </>
        )}
      </Button>
    </form>
  );
}
