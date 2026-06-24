import { z } from 'zod';

export const reserveSchema = z.object({
  routeId: z.string().uuid(),
  pickupStopId: z.string().uuid(),
  dropStopId: z.string().uuid(),
});
export const cancelSchema = z.object({ bookingId: z.string().uuid() });

export type ReserveInput = z.infer<typeof reserveSchema>;
