'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { AppError, toErrorResponse } from '@/lib/errors/app-error';

export type LinkChildState = { ok?: boolean; childName?: string; alreadyLinked?: boolean; error?: string };
export type UnlinkChildState = { ok?: boolean; error?: string };
export type ParentCodeState = { code?: string; expiresAt?: string; error?: string };
export type ManagedChildState = { ok?: boolean; childName?: string; studentId?: string; error?: string };

const unlinkSchema = z.object({ studentId: z.string().uuid() });
const redeemSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Please enter the 6-digit code.'),
});

const addChildSchema = z.object({
  fullName: z.string().trim().min(2, 'Please enter the child’s name.').max(120),
  institutionId: z.string().uuid('Please choose a campus.'),
  // Phone + address are required — reserve_seat gates on them, so a managed child
  // is always bookable straight after being added.
  phone: z.string().trim().min(7, 'Please enter a contact phone number.').max(20),
  address: z.string().trim().min(5, 'Please enter the pickup address.').max(300),
  grade: z.string().trim().max(40).optional(),
  rollNo: z.string().trim().max(40).optional(),
  email: z.string().trim().email('Enter a valid email.').max(160).optional().or(z.literal('')),
});
const editChildSchema = addChildSchema
  .omit({ institutionId: true })
  .extend({ studentId: z.string().uuid() });

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
  const managed = String(formData.get('managed') ?? '') === 'true';
  try {
    // A managed child (no login) is fully removed; a login-backed child is just
    // unlinked from the parent's dashboard.
    const { error } = managed
      ? await db.rpc('remove_managed_child', { p_student_id: parsed.data.studentId })
      : await db.rpc('unlink_child', { p_student_id: parsed.data.studentId });
    if (error) throw new AppError('PARENT', error.message);
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  revalidatePath('/parent');
  return { ok: true };
}

/** PARENT side: add a child that has no login of their own (a managed child). */
export async function addManagedChildAction(
  _: ManagedChildState,
  formData: FormData,
): Promise<ManagedChildState> {
  const parsed = addChildSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please complete the form.' };
  }
  const d = parsed.data;
  const db = await createClient();
  try {
    const { data, error } = await db.rpc('create_managed_student', {
      p_full_name: d.fullName,
      p_institution_id: d.institutionId,
      p_grade: d.grade ?? null,
      p_roll_no: d.rollNo ?? null,
      p_address: d.address ?? null,
      p_phone: d.phone ?? null,
      p_email: d.email ? d.email : null,
    });
    if (error) throw new AppError('PARENT', error.message);
    const row = (Array.isArray(data) ? data[0] : data) as
      | { id: string; full_name: string | null }
      | undefined;
    revalidatePath('/parent');
    return { ok: true, childName: d.fullName, studentId: row?.id };
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
}

/** PARENT side: edit a managed child's details. */
export async function editManagedChildAction(
  _: ManagedChildState,
  formData: FormData,
): Promise<ManagedChildState> {
  const parsed = editChildSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please complete the form.' };
  }
  const d = parsed.data;
  const db = await createClient();
  try {
    const { error } = await db.rpc('update_managed_student', {
      p_student_id: d.studentId,
      p_full_name: d.fullName,
      p_grade: d.grade ?? null,
      p_roll_no: d.rollNo ?? null,
      p_address: d.address ?? null,
      p_phone: d.phone ?? null,
      p_email: d.email ? d.email : null,
    });
    if (error) throw new AppError('PARENT', error.message);
    revalidatePath('/parent');
    revalidatePath(`/parent/book/${d.studentId}`);
    return { ok: true, childName: d.fullName, studentId: d.studentId };
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
}
