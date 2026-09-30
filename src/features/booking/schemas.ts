import { z } from 'zod';

export const reserveSchema = z.object({
  routeId: z.string().uuid(),
  pickupStopId: z.string().uuid(),
  // Drop-off is always the campus (institution), so students don't pick it.
  // Optional/empty → stored as null on the booking.
  dropStopId: z.union([z.string().uuid(), z.literal('')]).optional(),
  // The pricing plan the student chose (per month / semester / year). Optional
  // for legacy clients — reserve_seat falls back to the route's primary plan.
  billingPeriod: z.enum(['MONTHLY', 'SEMESTER', 'YEARLY']).optional(),
  // Parent-books-for-a-child: the student to book for. Absent → the caller books
  // for themselves (reserve_seat authorizes a linked parent when present).
  studentId: z.union([z.string().uuid(), z.literal('')]).optional(),
});
export const cancelSchema = z.object({
  bookingId: z.string().uuid(),
  // When a parent cancels a child's booking (so the action can revalidate /parent).
  studentId: z.union([z.string().uuid(), z.literal('')]).optional(),
  // Why the student is cancelling / leaving the agency.
  reason: z.string().trim().max(600).optional(),
  // Where to send a refund (only collected for a paid booking).
  refundMethod: z.enum(['UPI', 'BANK']).optional(),
  upiId: z.string().trim().max(120).optional(),
  accountName: z.string().trim().max(120).optional(),
  accountNumber: z.string().trim().max(40).optional(),
  ifsc: z.string().trim().max(20).optional(),
});
// Real UPI payment (no gateway): the rider pays to the platform VPA, then submits
// the 12-digit UPI reference (UTR). A SUPER_ADMIN verifies it to confirm the seat.
export const submitUpiSchema = z.object({
  bookingId: z.string().uuid(),
  // Present when a parent is paying for a child's booking (revalidates /parent).
  studentId: z.union([z.string().uuid(), z.literal('')]).optional(),
  utr: z
    .string()
    .trim()
    .regex(/^\d{12}$/, 'Enter the 12-digit UPI reference (UTR) from your UPI app.'),
});

// Trimmed so whitespace-only input fails here instead of saving and then being
// bounced back by the booking gate (which checks the trimmed values).
export const studentDetailsSchema = z.object({
  fullName: z.string().trim().min(2, 'Please enter your full name.'),
  phone: z
    .string()
    .trim()
    .min(7, 'Please enter a valid phone number.')
    .max(20, 'Phone number is too long.'),
  address: z.string().trim().min(5, 'Please enter your address.'),
  grade: z.string().trim().optional(),
  guardianName: z.string().trim().optional(),
  guardianPhone: z.string().trim().max(20, 'Phone number is too long.').optional().or(z.literal('')),
});

export type ReserveInput = z.infer<typeof reserveSchema>;
export type StudentDetailsInput = z.infer<typeof studentDetailsSchema>;
