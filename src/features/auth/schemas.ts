import { z } from 'zod';
import { ROLES } from '@/lib/rbac/roles';

export const registerSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(ROLES),
});
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export const forgotSchema = z.object({ email: z.string().email() });
export const resetSchema = z.object({ password: z.string().min(8) });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
