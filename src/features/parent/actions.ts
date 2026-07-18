'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { AppError, toErrorResponse } from '@/lib/errors/app-error';

export type LinkChildState = { ok?: boolean; childName?: string; error?: string };
export type UnlinkChildState = { ok?: boolean; error?: string };

const linkSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address.'),
});
const unlinkSchema = z.object({ studentId: z.string().uuid() });

/** Link a child by the email of their student account. */
export async function linkChildAction(
  _: LinkChildState,
  formData: FormData,
): Promise<LinkChildState> {
  const parsed = linkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please check the email.' };
  }
  const db = await createClient();
  try {
    const { data, error } = await db.rpc('link_child', { p_email: parsed.data.email });
    if (error) throw new AppError('PARENT', error.message);
    const row = (Array.isArray(data) ? data[0] : data) as
      | { full_name: string | null }
      | undefined;
    revalidatePath('/parent');
    return { ok: true, childName: row?.full_name ?? undefined };
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
}

/** Remove a linked child from the parent's dashboard. */
export async function unlinkChildAction(
  _: UnlinkChildState,
  formData: FormData,
): Promise<UnlinkChildState> {
  const parsed = unlinkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Could not identify that child.' };
  const db = await createClient();
  try {
    const { error } = await db.rpc('unlink_child', { p_student_id: parsed.data.studentId });
    if (error) throw new AppError('PARENT', error.message);
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  revalidatePath('/parent');
  return { ok: true };
}
