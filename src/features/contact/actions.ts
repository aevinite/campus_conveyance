'use server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendContactInquiryEmail } from '@/lib/mailer';

export type ContactState = { ok?: boolean; error?: string };

const contactSchema = z.object({
  name: z.string().trim().min(2, 'Please enter your name.').max(120),
  email: z.string().trim().email('Please enter a valid email address.').max(200),
  phone: z.string().trim().max(20, 'Phone number is too long.').optional().or(z.literal('')),
  organization: z.string().trim().max(200).optional().or(z.literal('')),
  message: z.string().trim().min(5, 'Please write a short message.').max(4000),
});

/**
 * Landing-page "Contact Us" submission (anonymous visitors). The inquiry is
 * stored in contact_messages (service role — the table is RLS-locked to the
 * admin) and forwarded to the platform inbox by email. The DB row is the
 * source of truth; a mail hiccup must not lose the inquiry.
 */
export async function submitContactAction(input: {
  name: string;
  email: string;
  phone?: string;
  organization?: string;
  message: string;
}): Promise<ContactState> {
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please check the form.' };
  }
  const { name, email, phone, organization, message } = parsed.data;

  const db = createAdminClient();
  const { error } = await db.from('contact_messages').insert({
    name,
    email,
    phone: phone || null,
    organization: organization || null,
    message,
  });
  if (error) {
    return { error: 'Could not send your message right now — please try again.' };
  }

  try {
    await sendContactInquiryEmail({ name, email, phone, organization, message });
  } catch {
    // Best-effort: the inquiry is already saved for the admin.
  }
  return { ok: true };
}
