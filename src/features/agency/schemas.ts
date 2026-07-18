import { z } from 'zod';

/** Optional URL field that also accepts an empty string (paste-a-URL inputs). */
const urlOpt = z.union([z.string().url(), z.literal('')]).optional();

// Manual details the agency fills in; an admin reviews and accepts/rejects.
// (No automated/government KYC — that isn't feasible here.)
export const agencyRegisterSchema = z.object({
  name: z.string().min(2),
  contactPerson: z.string().min(2, 'Enter the contact person’s name.'),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().min(6),
  legalName: z.string().min(2),
  registrationNo: z.string().min(2), // CIN / Udyam
  gstNumber: z.string().min(2),
  panNumber: z.string().min(2),
  registeredAddress: z.string().min(4),
  permitDocUrl: urlOpt,
  fitnessDocUrl: urlOpt,
  // Which colleges/schools this agency will serve, and what it operates.
  institutionIds: z
    .array(z.string().uuid())
    .min(1, 'Select at least one college/school you serve.'),
  vehicleTypes: z
    .array(z.enum(['BUS', 'VAN']))
    .min(1, 'Select at least one service type (bus and/or van).'),
});

// Editable business/verification details shown on the agency Profile page —
// the same fields captured on the signup form (email is not editable here).
export const agencyProfileSchema = z.object({
  name: z.string().min(2, 'Enter your provider / company name.'),
  contactPerson: z.string().min(2, 'Enter the contact person’s name.'),
  phone: z.string().min(6, 'Enter a valid phone number.'),
  legalName: z.string().min(2, 'Enter the registered legal name.'),
  registrationNo: z.string().min(2, 'Enter the registration number.'),
  gstNumber: z.string().min(2, 'Enter the GST number.'),
  panNumber: z.string().min(2, 'Enter the PAN number.'),
  registeredAddress: z.string().min(4, 'Enter the registered address.'),
  description: z.string().optional(),
  permitDocUrl: urlOpt,
  fitnessDocUrl: urlOpt,
});

export const serviceSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  institutionId: z.string().uuid(),
  vehicleType: z.enum(['BUS', 'VAN']),
  imageUrl: urlOpt,
});

// A provider asks to serve a new college/school (or add a vehicle type there).
// Admin-reviewed, and a description is mandatory so the admin has context.
export const serviceRequestSchema = z.object({
  name: z.string().min(2, 'Enter a service name.'),
  description: z
    .string()
    .min(10, 'Please describe this service (at least 10 characters).'),
  institutionId: z.string().uuid('Select a school/college.'),
  vehicleType: z.enum(['BUS', 'VAN']),
});

// A bus is just the agency's own vehicle — no "service" to pick. All details are
// typed in by the agency; photos are uploaded from the device (handled in the
// action), so there are no link/URL fields here.
export const busSchema = z.object({
  busNumber: z.string().min(1, 'Enter a bus number (e.g. 1).'),
  registrationNo: z.string().min(1, 'Enter the RC / registration number.'),
  capacity: z.coerce
    .number()
    .int()
    .min(1, 'Enter the seat capacity.')
    .max(100, 'Seat capacity cannot be more than 100.'),
  acType: z.enum(['AC', 'NON_AC']),
  busModel: z.string().optional(),
  busColor: z.string().optional(),
  driverName: z.string().min(2, 'Enter the driver’s name.'),
  driverPhone: z.string().min(6, 'Enter the driver’s phone number.'),
  driverEmail: z.union([z.string().email('Enter a valid driver email.'), z.literal('')]).optional(),
  driverLicenseNo: z.string().min(1, 'Enter the driver’s licence number.'),
  driverExperienceYears: z.preprocess(
    (v) => (v === '' || v == null ? undefined : v),
    z.coerce.number().int().min(0).optional(),
  ),
  // Optional: link this bus to a driver login account (from the agency's drivers).
  driverId: z.union([z.string().uuid(), z.literal('')]).optional(),
});

// Departure must be a real clock time (HH:MM, optional seconds) — anything else
// used to reach the database's `time` column and fail there instead of the form.
const departureTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Enter a valid departure time (HH:MM).');

// A route belongs to the agency and ends at one of the colleges it serves.
// No separate start location — the first pickup stop is where pickup begins.
export const routeSchema = z.object({
  institutionId: z.string().uuid('Select the college / school.'),
  vehicleId: z.string().uuid('Select a bus.'),
  priceRupees: z.coerce.number().min(0),
  departureTime,
  imageUrl: urlOpt,
});

// Editing an existing route: price + time (stops handled separately).
export const routeEditSchema = z.object({
  priceRupees: z.coerce.number().min(0),
  departureTime,
});

// The agency creates a driver's login account (drivers can't self-register).
export const driverSchema = z.object({
  name: z.string().min(2, 'Enter the driver’s name.'),
  email: z.string().email('Enter a valid email for the driver.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  phone: z.string().optional(),
  licenseNo: z.string().optional(),
});

// Editing a driver. Password is optional (blank = keep current).
export const driverEditSchema = z.object({
  name: z.string().min(2, 'Enter the driver’s name.'),
  email: z.string().email('Enter a valid email for the driver.'),
  phone: z.string().optional(),
  licenseNo: z.string().optional(),
  password: z.union([z.string().min(8, 'New password must be at least 8 characters.'), z.literal('')]).optional(),
  isActive: z.enum(['true', 'false']),
});

export type AgencyRegisterInput = z.infer<typeof agencyRegisterSchema>;
export type AgencyProfileInput = z.infer<typeof agencyProfileSchema>;
export type ServiceInput = z.infer<typeof serviceSchema>;
export type ServiceRequestInput = z.infer<typeof serviceRequestSchema>;
export type BusInput = z.infer<typeof busSchema>;
export type RouteInput = z.infer<typeof routeSchema>;
export type RouteEditInput = z.infer<typeof routeEditSchema>;
export type DriverInput = z.infer<typeof driverSchema>;
export type DriverEditInput = z.infer<typeof driverEditSchema>;
