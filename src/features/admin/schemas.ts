import { z } from 'zod';

const urlOpt = z.union([z.string().url(), z.literal('')]).optional();

export const collegeSchema = z.object({
  name: z.string().min(2),
  area: z.string().optional(),
  city: z.string().optional(),
  kind: z.enum(['SCHOOL', 'COLLEGE']),
  imageUrl: urlOpt,
  description: z.string().optional(),
  // Checkbox: present ("on") when ticked, absent otherwise → defaults to false.
  verified: z.coerce.boolean().default(false),
});

export type CollegeInput = z.infer<typeof collegeSchema>;

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base || 'college'}-${Math.random().toString(36).slice(2, 7)}`;
}
