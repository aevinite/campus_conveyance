import { z } from 'zod';

export const registerSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  // The public sign-up form only offers Student and Parent. AGENCY, DRIVER,
  // INSTITUTION_ADMIN and SUPER_ADMIN are provisioned through dedicated,
  // gated flows — so the backend must reject them here too, otherwise a crafted
  // request could self-register as an agency/admin. (Was `z.enum(ROLES)`.)
  role: z.enum(['STUDENT', 'PARENT']),
});
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export const forgotSchema = z.object({ email: z.string().email() });
export const resetSchema = z.object({ password: z.string().min(8) });

export const profileSchema = z.object({
  fullName: z.string().min(2, 'Please enter your name (at least 2 characters).'),
  phone: z.string().max(20, 'Phone number is too long.').optional().or(z.literal('')),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: z.string().min(8, 'New password must be at least 8 characters.'),
    confirmPassword: z.string().min(1, 'Please re-enter the new password.'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'The new passwords do not match.',
    path: ['confirmPassword'],
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: 'New password must be different from the current one.',
    path: ['newPassword'],
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
