'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { AppError, toErrorResponse } from '@/lib/errors/app-error';

export type LinkChildState = { ok?: boolean; childName?: string; alreadyLinked?: boolean; error?: string };
export type UnlinkChildState = { ok?: boolean; error?: string };
export type ParentCodeState = { code?: string; expiresAt?: string; error?: string };

const unlinkSchema = z.object({ studentId: z.string().uuid() });
const redeemSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Please enter the 6-digit code.'),
});

/** STUDENT side: mint a fresh 6-digit parent code (valid 3 minutes, single use). */
export async function createParentCodeAction(
  prevState: ParentCodeState,
  formData: FormData,
): Promise<ParentCodeState> {
  void prevState;
  void formData;
  const db = await createClient();
  try {
    const { data, error } = await db.rpc('create_parent_link_code');
    if (error) throw new AppError('PARENT', error.message);
    const row = (Array.isArray(data) ? data[0] : data) as
      | { code: string; expires_at: string }
      | undefined;
    if (!row?.code) return { error: 'Could not generate a code — try again.' };
    return { code: row.code, expiresAt: row.expires_at };
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
}

/** PARENT side: enter the child's code → linked. */
export async function redeemParentCodeAction(
  _: LinkChildState,
  formData: FormData,
): Promise<LinkChildState> {
  const parsed = redeemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please enter the 6-digit code.' };
  }
  const db = await createClient();
  try {
    const { data, error } = await db.rpc('redeem_parent_link_code', {
      p_code: parsed.data.code,
    });
    if (error) throw new AppError('PARENT', error.message);
    const row = (Array.isArray(data) ? data[0] : data) as
      | { full_name: string | null; already_linked: boolean | null }
      | undefined;
    revalidatePath('/parent');
    return {
      ok: true,
      childName: row?.full_name ?? undefined,
      alreadyLinked: row?.already_linked === true,
    };
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
