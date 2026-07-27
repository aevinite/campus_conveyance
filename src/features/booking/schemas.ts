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
});
export const cancelSchema = z.object({
  bookingId: z.string().uuid(),
  // Why the student is cancelling / leaving the agency.
  reason: z.string().trim().max(600).optional(),
  // Where to send a refund (only collected for a paid booking).
  refundMethod: z.enum(['UPI', 'BANK']).optional(),
  upiId: z.string().trim().max(120).optional(),
  accountName: z.string().trim().max(120).optional(),
  accountNumber: z.string().trim().max(40).optional(),
  ifsc: z.string().trim().max(20).optional(),
});
// Cash-on-board was removed: the agency can only confirm PAID bookings, and
// without a gateway every online method completes the mock payment instantly.
export const paySchema = z.object({
  bookingId: z.string().uuid(),
  method: z.enum(['UPI', 'CARD', 'NETBANKING']),
});

export const studentDetailsSchema = z.object({
  fullName: z.string().min(2, 'Please enter your full name.'),
  phone: z
    .string()
    .min(7, 'Please enter a valid phone number.')
    .max(20, 'Phone number is too long.'),
  address: z.string().min(5, 'Please enter your address.'),
  grade: z.string().optional(),
  guardianName: z.string().optional(),
  guardianPhone: z.string().max(20, 'Phone number is too long.').optional().or(z.literal('')),
});

export type ReserveInput = z.infer<typeof reserveSchema>;
export type StudentDetailsInput = z.infer<typeof studentDetailsSchema>;
