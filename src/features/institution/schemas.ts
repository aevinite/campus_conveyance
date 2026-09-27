import { z } from 'zod';

/** Optional URL field that also accepts an empty string (paste-a-URL inputs). */
const urlOpt = z.union([z.string().url(), z.literal('')]).optional();

// A school/college self-registers its campus. An admin reviews and approves it
// before it goes live (visible to agencies + students) — mirrors the agency
// application flow. `kind` decides School vs College/University.
export const institutionRegisterSchema = z.object({
  name: z.string().min(2, 'Enter your school / college name.'),
  kind: z.enum(['SCHOOL', 'COLLEGE']),
  contactPerson: z.string().min(2, 'Enter the contact person’s name.'),
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  phone: z.string().min(6, 'Enter a valid phone number.'),
  city: z.string().optional(),
  area: z.string().optional(),
  description: z.string().optional(),
  imageUrl: urlOpt,
});

export type InstitutionRegisterInput = z.infer<typeof institutionRegisterSchema>;
