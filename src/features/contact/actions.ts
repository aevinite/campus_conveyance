'use server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendContactInquiryEmail } from '@/lib/mailer';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

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

  // This is an anonymous endpoint that sends Gmail/Nodemailer mail per call, so
  // it must be capped like every other mail path — an uncapped flood exhausts the
  // shared Gmail quota and breaks signup/reset mail platform-wide. Cap per IP and
  // per sender email.
  const ip = await getClientIp();
  const tooBusy = 'Too many messages just now — please try again in a little while.';
  // Skip the per-IP cap when the IP is unknown (no x-forwarded-for on a
  // self-hosted `next start`), else every visitor collapses onto one 'unknown'
  // bucket and 5 total submissions disable the form for everyone. The per-email
  // cap still applies. (Mirrors the agency OTP guard.)
  if (ip !== 'unknown' && (await rateLimit('contact:ip', ip, 5, 60 * 60)) > 0) {
    return { error: tooBusy };
  }
  if ((await rateLimit('contact:email', email, 3, 60 * 60)) > 0) return { error: tooBusy };

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
  } catch (e) {
    // Best-effort: the inquiry is already saved for the admin — but log the
    // mail failure, otherwise a misconfigured CONTACT_INBOX/SMTP is invisible.
    console.error('Contact inquiry email failed to send:', e);
  }
  return { ok: true };
}
