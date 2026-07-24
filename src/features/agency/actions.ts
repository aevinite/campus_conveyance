'use server';
import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { toErrorResponse, AppError } from '@/lib/errors/app-error';
import { sendSignupConfirmationEmail, sendEmailOtpEmail } from '@/lib/mailer';
import { createOtpChallenge, verifyOtpChallenge, isEmailVerified } from './email-otp';
import {
  agencyRegisterSchema,
  agencyProfileSchema,
  serviceRequestSchema,
  busSchema,
  busDriverChangeSchema,
  routeSchema,
  routeEditSchema,
  driverSchema,
  driverEditSchema,
} from './schemas';
import { getMyAgency, agencyReportTag } from './repository';
import {
  confirmBooking,
  rejectBooking,
  addRoute,
  updateRoute,
  type RouteStopInput,
} from './services';
import {
  ensureEmailFreeForSignup,
  isEmailTakenByActiveAccount,
  signInAndRoute,
} from '@/features/auth/services';
import { loginSchema } from '@/features/auth/schemas';
import { rateLimit, getClientIp, registerOtpAttempt, clearOtpFailures } from '@/lib/rate-limit';

// Guard id-shaped form inputs before they reach Postgres so a malformed value is
// a clean no-op instead of a 22P02 (invalid uuid) crash to the error page.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Shared email-sending caps (per address, and a combined per-IP ceiling across
// all outbound mail). Small numbers — signups/resets are rare, abuse is not.
const EMAIL_PER_ADDRESS = 3;
const EMAIL_PER_ADDRESS_WINDOW = 15 * 60;
const EMAIL_PER_IP = 20;
const EMAIL_PER_IP_WINDOW = 60 * 60;

function retryMessage(seconds: number): string {
  const mins = Math.ceil(seconds / 60);
  return mins <= 1 ? 'Please wait a minute and try again.' : `Please wait about ${mins} minutes and try again.`;
}

export type FormState = { error?: string; message?: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Agency-signup email verification (step 1 of the form). Sends a 6-digit code to
 * the address and returns a stateless challenge token the client hands back when
 * confirming. Scoped to this form only — used from the register page directly.
 */
export async function sendAgencyEmailOtp(
  email: string,
): Promise<{ error?: string; token?: string }> {
  const clean = (email ?? '').trim();
  if (!EMAIL_RE.test(clean)) return { error: 'Enter a valid email address.' };

  // Rate limit BEFORE sending (per address, then a per-IP ceiling) — a "send
  // code" button that mails on demand is an email-bomb + Gmail-quota-exhaustion
  // vector, and quota exhaustion re-breaks every real signup/reset.
  const perEmail = await rateLimit('email:otp', clean, EMAIL_PER_ADDRESS, EMAIL_PER_ADDRESS_WINDOW);
  if (perEmail > 0) return { error: `Too many codes requested for this email. ${retryMessage(perEmail)}` };
  // Per-IP ceiling only when the IP is known — on a plain `next start` (no proxy)
  // there's no x-forwarded-for, so everyone shares the 'unknown' bucket and 20
  // sends/hour would lock the whole site. Per-address cap above still applies.
  const ip = await getClientIp();
  if (ip !== 'unknown') {
    const perIp = await rateLimit('email:ip', ip, EMAIL_PER_IP, EMAIL_PER_IP_WINDOW);
    if (perIp > 0) return { error: `Too many requests. ${retryMessage(perIp)}` };
  }

  const admin = createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  // Don't send a code to an address that's already a live account — but this is a
  // READ-ONLY check. The old code called ensureEmailFreeForSignup here, which
  // HARD-DELETES an unconfirmed/soft-deleted auth user (and orphaned agency rows)
  // — so merely clicking "send code" destroyed a pre-existing account. That
  // purge now happens only at real registration (agencyRegisterAction below).
  if (await isEmailTakenByActiveAccount(admin, clean)) {
    return { error: 'This email is already registered. Please sign in instead.' };
  }
  const { token, code } = createOtpChallenge(clean);
  try {
    await sendEmailOtpEmail(clean, code);
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  return { token };
}

/** Confirm the code the user typed; returns a short-lived "verified" proof. */
export async function verifyAgencyEmailOtp(
  email: string,
  code: string,
  token: string,
): Promise<{ error?: string; verifiedToken?: string }> {
  const clean = (email ?? '').trim();
  if (!/^\d{6}$/.test((code ?? '').trim())) return { error: 'Enter the 6-digit code.' };

  // Brute-force lockout: the OTP is a stateless HMAC, so without an attempt
  // counter all 1,000,000 six-digit codes could be guessed. Atomically reserve
  // an attempt (per email, so requesting fresh codes can't reset it) BEFORE
  // checking the code — the reservation is what bounds concurrent guessing.
  const lock = await registerOtpAttempt(clean);
  if (lock > 0) {
    return { error: `Too many incorrect attempts. ${retryMessage(lock)}` };
  }

  const res = verifyOtpChallenge(clean, code, token);
  if (!res.ok) {
    // Attempt already counted atomically above; nothing to record here.
    return { error: 'Incorrect or expired code. Request a new one and try again.' };
  }
  await clearOtpFailures(clean);
  return { verifiedToken: res.verifiedToken };
}

export async function agencyRegisterAction(
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  // Checkboxes send multiple values under the same name — pull them as arrays
  // (Object.fromEntries would keep only the last one).
  const parsed = agencyRegisterSchema.safeParse({
    ...Object.fromEntries(formData),
    institutionIds: formData.getAll('institutionIds'),
    vehicleTypes: formData.getAll('vehicleTypes'),
  });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ??
        'Please complete every required field correctly.',
    };
  }
  const d = parsed.data;
  // Guard: the email must carry a valid "verified" proof from the OTP step. This
  // is enforced server-side too so the check can't be skipped from the client.
  if (!isEmailVerified(d.email, String(formData.get('emailVerifiedToken') ?? ''))) {
    return { error: 'Please verify your email address before submitting.' };
  }
  // Rate-limit the submit path too (not just OTP send) — it creates an auth user
  // + mails a confirmation, so an uncapped loop is an abuse/quota vector.
  const registerIp = await getClientIp();
  const registerBusy = 'Too many registration attempts — please try again later.';
  if (registerIp !== 'unknown' && (await rateLimit('agency-register:ip', registerIp, 5, 60 * 60)) > 0) {
    return { error: registerBusy };
  }
  if ((await rateLimit('agency-register:email', d.email, 3, 60 * 60)) > 0) {
    return { error: registerBusy };
  }
  const site = process.env.NEXT_PUBLIC_SITE_URL!;
  // All KYC goes into user metadata; the handle_new_user trigger creates the
  // PENDING agency row from it. We create the account + confirmation link with
  // the admin API (no email sent) and mail it ourselves from Gmail, bypassing
  // Supabase's rate-limited built-in mailer that was blocking agency signups.
  const admin = createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  // Free up the email if a previous, never-confirmed signup is still holding it.
  const free = await ensureEmailFreeForSignup(admin, d.email);
  if (free.error) return { error: free.error };
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'signup',
    email: d.email,
    password: d.password,
    options: {
      // Land on the client /confirm page (reads the #hash session + routes to
      // the dashboard); the server /auth/callback route can't read the hash.
      redirectTo: `${site}/confirm`,
      data: {
        full_name: d.name,
        // No separate username field anymore — derive a handle from the contact
        // person's name (letters/numbers/dot/underscore only).
        username:
          d.contactPerson.trim().toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '') ||
          'agency',
        role: 'AGENCY',
        phone: d.phone,
        contact_person: d.contactPerson,
        legal_name: d.legalName,
        registration_no: d.registrationNo,
        gst_number: d.gstNumber,
        pan_number: d.panNumber,
        registered_address: d.registeredAddress,
        permit_doc_url: d.permitDocUrl ?? '',
        fitness_doc_url: d.fitnessDocUrl ?? '',
        institution_ids: d.institutionIds,
        vehicle_types: d.vehicleTypes,
      },
    },
  });
  if (error) return { error: error.message };
  try {
    await sendSignupConfirmationEmail(d.email, data.properties.action_link);
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  redirect('/agency/login?pending=1');
}

export async function agencyLoginAction(
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Please check your email and password.' };
  const db = await createClient();
  // Same shared login sequence as the student login (auth + soft-delete gate +
  // redirect to the account's REAL role's dashboard) — see signInAndRoute. Kept
  // in one place so future login hardening can't land here and be forgotten in
  // the other login action (or vice-versa).
  return { error: await signInAndRoute(db, parsed.data) };
}

/** Resolve the caller's APPROVED agency id or throw. */
async function requireApprovedAgency(db: Awaited<ReturnType<typeof createClient>>) {
  const agency = await getMyAgency(db);
  if (!agency) throw new AppError('AGENCY', 'No agency found for this account.');
  if (agency.status !== 'APPROVED')
    throw new AppError('AGENCY', 'Your agency is not approved yet.');
  return agency;
}

/** Update the agency's business/verification details (owner-editable). */
export async function updateAgencyProfileAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = agencyProfileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please check the details.' };
  }
  const db = await createClient();
  try {
    const agency = await getMyAgency(db);
    if (!agency) throw new AppError('AGENCY', 'No agency found for this account.');
    const d = parsed.data;
    const { error } = await db
      .from('agencies')
      .update({
        name: d.name,
        contact_person: d.contactPerson,
        phone: d.phone,
        legal_name: d.legalName,
        registration_no: d.registrationNo,
        gst_number: d.gstNumber,
        pan_number: d.panNumber,
        registered_address: d.registeredAddress,
        description: d.description || null,
        permit_doc_url: d.permitDocUrl || null,
        fitness_doc_url: d.fitnessDocUrl || null,
      })
      .eq('id', agency.id);
    if (error) throw new AppError('AGENCY', error.message);
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  revalidatePath('/agency/account');
  // The agency name shows in the admin report — bust its cache so the edit isn't
  // ~60s stale there.
  updateTag('admin-report');
  return { message: 'Business details updated.' };
}

/**
 * Request to serve a new college/school (or add a vehicle type there). This no
 * longer adds the service directly — it files a PENDING request that an admin
 * reviews. The service only goes live once the admin approves it.
 */
export async function requestServiceAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = serviceRequestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please complete the request.' };
  }
  const db = await createClient();
  try {
    const agency = await requireApprovedAgency(db);
    // Dedup: a pending request for the same college+vehicle type shouldn't be
    // filed twice (double-submit / re-request), which clutters the admin queue.
    const { data: existing, error: dupErr } = await db
      .from('agency_service_requests')
      .select('id')
      .eq('agency_id', agency.id)
      .eq('institution_id', parsed.data.institutionId)
      .eq('vehicle_type', parsed.data.vehicleType)
      .eq('status', 'PENDING')
      .limit(1)
      .maybeSingle();
    if (dupErr) throw new AppError('SERVICE', dupErr.message);
    if (existing) {
      return { error: 'You already have a pending request for this college and vehicle type.' };
    }
    const { error } = await db.from('agency_service_requests').insert({
      agency_id: agency.id,
      institution_id: parsed.data.institutionId,
      vehicle_type: parsed.data.vehicleType,
      name: parsed.data.name,
      description: parsed.data.description,
      status: 'PENDING',
    });
    // The check above is a fast path; the partial unique index uq_asr_pending
    // (migration 0089) is the real guard. A concurrent double-submit that slips
    // past the check hits it here — map that to the same friendly message rather
    // than a raw 23505.
    if (error?.code === '23505') {
      return { error: 'You already have a pending request for this college and vehicle type.' };
    }
    if (error) throw new AppError('SERVICE', error.message);
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  revalidatePath('/agency/account');
  return { message: 'Request submitted — an admin will review it shortly.' };
}

/** A URL only counts if it points at our own vehicle-photos storage bucket. */
function ownStoragePhoto(value: FormDataEntryValue | null): string | null {
  const url = typeof value === 'string' ? value.trim() : '';
  if (!url) return null;
  return url.includes('/storage/v1/object/public/vehicle-photos/') ? url : null;
}

const MIN_BUS_PHOTOS = 5;
// Editing an EXISTING bus only needs to keep at least one photo (for the cover).
// Requiring the full 5 on edit meant legacy buses added before the 5-photo rule
// could never be edited at all — even to fix a phone number.
const MIN_BUS_PHOTOS_EDIT = 1;

/** Parse the JSON bus-photos array, keeping only valid own-bucket URLs (max 15). */
function parseBusPhotos(value: FormDataEntryValue | null): string[] {
  let raw: unknown[] = [];
  try {
    const p = JSON.parse(String(value ?? '[]'));
    raw = Array.isArray(p) ? p : [];
  } catch {
    raw = [];
  }
  const out: string[] = [];
  for (const u of raw) {
    const ok = ownStoragePhoto(typeof u === 'string' ? u : null);
    if (ok && !out.includes(ok)) out.push(ok);
    if (out.length >= 15) break;
  }
  return out;
}

/** Validate the chosen driver belongs to this agency; else null (no assignment). */
async function resolveAgencyDriverId(
  db: Awaited<ReturnType<typeof createClient>>,
  agencyId: string,
  driverId: string | undefined,
  excludeBusId?: string,
): Promise<string | null> {
  if (!driverId) return null;
  // Targeted owner-checked lookup (migration 0065) — no full-roster fetch.
  const { data, error } = await db.rpc('agency_driver', { p_agency_id: agencyId, p_driver_id: driverId });
  // Surface a transient failure instead of masking it as "driver invalid" — that
  // would silently drop the assignment and save a bus with no driver.
  if (error) throw new AppError('AGENCY', error.message);
  if (((data ?? []) as unknown[]).length === 0) return null;
  // A driver can be the PERMANENT driver of only one bus. If already assigned to
  // a DIFFERENT vehicle, don't assign here (server backstop; the edit dropdown
  // also filters to unassigned). excludeBusId keeps a bus's own driver on edit.
  let q = db.from('vehicles').select('id').eq('agency_id', agencyId).eq('driver_id', driverId);
  if (excludeBusId) q = q.neq('id', excludeBusId);
  const { data: taken, error: takenErr } = await q.limit(1).maybeSingle();
  if (takenErr) throw new AppError('AGENCY', takenErr.message);
  return taken ? null : driverId;
}

/** Map the uq_vehicles_driver unique violation (a driver already on another bus,
 *  lost the check-then-set race with 0077 as the backstop) to a friendly message
 *  instead of a raw Postgres constraint error. */
function driverAssignError(error: { message?: string }): AppError {
  if (error.message?.includes('uq_vehicles_driver')) {
    return new AppError('BUS', 'That driver is already assigned to another bus — pick a different driver.');
  }
  return new AppError('BUS', error.message ?? 'Could not save the bus.');
}

export async function addBusAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = busSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please complete the bus form.' };
  }
  const db = await createClient();
  try {
    const agency = await requireApprovedAgency(db);
    const d = parsed.data;
    // Photos are uploaded to Storage from the browser; only their URLs arrive here.
    const photos = parseBusPhotos(formData.get('busPhotos'));
    if (photos.length < MIN_BUS_PHOTOS) {
      return { error: `Please add at least ${MIN_BUS_PHOTOS} photos of the bus.` };
    }
    const driverPhotoUrl = ownStoragePhoto(formData.get('driverPhotoUrl'));
    const driverId = await resolveAgencyDriverId(db, agency.id, d.driverId);

    const { error } = await db.from('vehicles').insert({
      agency_id: agency.id,
      vehicle_type: 'BUS',
      bus_number: d.busNumber,
      registration_no: d.registrationNo,
      capacity: d.capacity,
      is_ac: d.acType === 'AC',
      bus_model: d.busModel || null,
      bus_color: d.busColor || null,
      photos,
      image_url: photos[0],
      driver_name: d.driverName,
      driver_phone: d.driverPhone,
      driver_email: d.driverEmail || null,
      driver_license_no: d.driverLicenseNo,
      driver_experience_years: d.driverExperienceYears ?? null,
      driver_govt_id: d.driverGovtId || null,
      driver_address: d.driverAddress || null,
      driver_alt_phone: d.driverAltPhone || null,
      driver_dob: d.driverDob || null,
      driver_blood_group: d.driverBloodGroup || null,
      driver_verified: d.driverVerified === 'on',
      driver_photo_url: driverPhotoUrl,
      conductor_name: d.conductorName || null,
      conductor_phone: d.conductorPhone || null,
      conductor_govt_id: d.conductorGovtId || null,
      conductor_address: d.conductorAddress || null,
      conductor_alt_phone: d.conductorAltPhone || null,
      conductor_dob: d.conductorDob || null,
      conductor_blood_group: d.conductorBloodGroup || null,
      conductor_verified: d.conductorVerified === 'on',
      driver_id: driverId,
    });
    if (error) throw driverAssignError(error);
    revalidatePath('/agency/add-bus');
    revalidatePath('/agency/buses');
    revalidatePath('/agency'); updateTag(agencyReportTag(agency.id)); // dashboard fleet tiles
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  return { message: 'Bus added.' };
}

/** Edit an existing bus. Photos are optional — a new URL replaces, blank keeps. */
export async function updateBusAction(_: FormState, formData: FormData): Promise<FormState> {
  const busId = String(formData.get('busId') ?? '');
  if (!busId) return { error: 'Missing bus reference.' };
  const parsed = busSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please complete the bus form.' };
  }
  const db = await createClient();
  try {
    const agency = await requireApprovedAgency(db);
    const d = parsed.data;
    const patch: Record<string, unknown> = {
      bus_number: d.busNumber,
      registration_no: d.registrationNo,
      capacity: d.capacity,
      is_ac: d.acType === 'AC',
      bus_model: d.busModel || null,
      bus_color: d.busColor || null,
      driver_name: d.driverName,
      driver_phone: d.driverPhone,
      driver_email: d.driverEmail || null,
      driver_license_no: d.driverLicenseNo,
      driver_experience_years: d.driverExperienceYears ?? null,
      driver_govt_id: d.driverGovtId || null,
      driver_address: d.driverAddress || null,
      driver_alt_phone: d.driverAltPhone || null,
      driver_dob: d.driverDob || null,
      driver_blood_group: d.driverBloodGroup || null,
      driver_verified: d.driverVerified === 'on',
      conductor_name: d.conductorName || null,
      conductor_phone: d.conductorPhone || null,
      conductor_govt_id: d.conductorGovtId || null,
      conductor_address: d.conductorAddress || null,
      conductor_alt_phone: d.conductorAltPhone || null,
      conductor_dob: d.conductorDob || null,
      conductor_blood_group: d.conductorBloodGroup || null,
      conductor_verified: d.conductorVerified === 'on',
      driver_id: await resolveAgencyDriverId(db, agency.id, d.driverId, busId),
    };
    // Bus photos: the edit form sends the full set. Only require at least one so
    // legacy buses with fewer than 5 photos remain editable.
    const photos = parseBusPhotos(formData.get('busPhotos'));
    if (photos.length < MIN_BUS_PHOTOS_EDIT) {
      return { error: 'Please keep at least one photo of the bus.' };
    }
    patch.photos = photos;
    patch.image_url = photos[0];
    // Driver photo: replace only if a new one was uploaded.
    const driverPhotoUrl = ownStoragePhoto(formData.get('driverPhotoUrl'));
    if (driverPhotoUrl) patch.driver_photo_url = driverPhotoUrl;

    const { error } = await db
      .from('vehicles')
      .update(patch)
      .eq('id', busId)
      .eq('agency_id', agency.id);
    if (error) throw driverAssignError(error);
    revalidatePath('/agency/buses');
    updateTag(agencyReportTag(agency.id)); // fleet split may change (e.g. AC/type edits)
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  return { message: 'Bus updated.' };
}

/**
 * Set a substitute driver for a bus for TODAY (the regular driver didn't turn
 * up). Doesn't touch the bus's permanent driver — it records a one-day override
 * that students and parents see as "driver changed for today".
 */
export async function changeBusDriverAction(_: FormState, formData: FormData): Promise<FormState> {
  const busId = String(formData.get('busId') ?? '');
  if (!busId) return { error: 'Missing bus reference.' };
  const parsed = busDriverChangeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please check the details.' };
  }
  const db = await createClient();
  try {
    await requireApprovedAgency(db);
    const d = parsed.data;
    const { error } = await db.rpc('set_bus_driver_today_by_driver', {
      p_vehicle_id: busId,
      p_driver_id: d.driverId,
      p_reason: d.reason || null,
      p_role: d.role,
    });
    if (error) throw new AppError('BUS', error.message);
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  revalidatePath('/agency/buses');
  const noun = parsed.data.role === 'CONDUCTOR' ? 'conductor' : 'driver';
  return { message: `Today’s ${noun} updated — students and parents will see the change.` };
}

/** Revert today's substitute so the bus shows its regular driver/conductor again. */
export async function revertBusDriverAction(_: FormState, formData: FormData): Promise<FormState> {
  const busId = String(formData.get('busId') ?? '');
  if (!busId) return { error: 'Missing bus reference.' };
  const role = String(formData.get('role') ?? 'DRIVER') === 'CONDUCTOR' ? 'CONDUCTOR' : 'DRIVER';
  const db = await createClient();
  try {
    await requireApprovedAgency(db);
    const { error } = await db.rpc('clear_bus_driver_today', { p_vehicle_id: busId, p_role: role });
    if (error) throw new AppError('BUS', error.message);
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  revalidatePath('/agency/buses');
  return { message: `Reverted to the regular ${role === 'CONDUCTOR' ? 'conductor' : 'driver'} for today.` };
}

/** Parse + validate the map stops JSON. Every stop needs coords + a description. */
function parseStops(
  value: FormDataEntryValue | null,
): { stops: RouteStopInput[] } | { error: string } {
  let raw: unknown[] = [];
  try {
    const p = JSON.parse(String(value ?? '[]'));
    raw = Array.isArray(p) ? p : [];
  } catch {
    raw = [];
  }
  const valid = raw
    .map((s) => s as Partial<RouteStopInput>)
    .filter(
      (s) =>
        typeof s.lat === 'number' &&
        Number.isFinite(s.lat) &&
        typeof s.lng === 'number' &&
        Number.isFinite(s.lng) &&
        typeof s.name === 'string' &&
        s.name.trim().length > 0,
    );
  if (valid.length === 0) return { error: 'Add at least one pickup stop on the map.' };
  if (valid.some((s) => !(typeof s.description === 'string' && s.description.trim().length > 0))) {
    return { error: 'Write a description (the exact spot) for every pickup stop.' };
  }
  const stops = valid.slice(0, 50).map((s) => ({
    name: String(s.name).trim().slice(0, 120),
    description: String(s.description).trim().slice(0, 300),
    lat: s.lat as number,
    lng: s.lng as number,
    address: s.address ? String(s.address).slice(0, 300) : null,
  }));
  return { stops };
}

export async function addRouteAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = routeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please complete the route form.' };
  }
  // Pickup stops picked on the map (submitted as JSON). At least one is required,
  // and every stop must have a description of the exact spot.
  const stopsResult = parseStops(formData.get('stops'));
  if ('error' in stopsResult) return { error: stopsResult.error };
  const stops = stopsResult.stops;

  const db = await createClient();
  try {
    const agency = await requireApprovedAgency(db);
    // The agency is the service — resolve its own service row for the chosen
    // college (prefer the BUS one) so the route stays linked, no picker needed.
    const { data: svc, error: svcErr } = await db
      .from('agency_services')
      .select('id')
      .eq('agency_id', agency.id)
      .eq('institution_id', parsed.data.institutionId)
      .order('vehicle_type', { ascending: true }) // 'BUS' before 'VAN'
      .limit(1)
      .maybeSingle();
    // Surface a lookup failure — otherwise the route is created UNLINKED to its
    // service (students browsing by service wouldn't see it).
    if (svcErr) throw new AppError('SERVICE', svcErr.message);
    // No approved service area for this college → refuse rather than create an
    // orphaned, service-unlinked route that would report "success" yet be
    // invisible to students. The agency must have an approved service here first.
    const serviceId = (svc as { id: string } | null)?.id ?? null;
    if (!serviceId) {
      return { error: 'You don’t have an approved service area for this college yet. Request one first.' };
    }
    await addRoute(db, agency.id, parsed.data, serviceId, stops);
    // The bus picker lives on /agency/add-route and hides buses already on a route;
    // revalidate THAT path (not the non-existent /agency/routes/new) so the just-
    // assigned bus disappears from the list and can't be put on a second route.
    revalidatePath('/agency/add-route');
    revalidatePath('/agency/routes');
    revalidatePath('/agency'); updateTag(agencyReportTag(agency.id)); // dashboard route/fleet tiles
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  return { message: 'Route added with pickup stops.' };
}

/**
 * Edit a route. Price/time always update. Stops can only be changed while the
 * route has no bookings (they reference the stops) — the RPC enforces this and
 * tells us whether the stops were actually replaced.
 */
export async function updateRouteAction(_: FormState, formData: FormData): Promise<FormState> {
  const routeId = String(formData.get('routeId') ?? '');
  if (!routeId) return { error: 'Missing route reference.' };
  const parsed = routeEditSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please check price and time.' };
  }
  const db = await createClient();
  try {
    const agency = await requireApprovedAgency(db);
    const { count, error: cntErr } = await db
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('route_id', routeId);
    // Surface the count error — a null count would treat a route WITH bookings as
    // having none and (wrongly) let its stops be edited (the RPC re-enforces, so
    // this is UX, but don't show a misleading form).
    if (cntErr) throw new AppError('ROUTE', cntErr.message);
    const hasBookings = (count ?? 0) > 0;

    let stops: RouteStopInput[] = [];
    if (!hasBookings) {
      const res = parseStops(formData.get('stops'));
      if ('error' in res) return { error: res.error };
      stops = res.stops;
    }
    const replaced = await updateRoute(
      db,
      routeId,
      parsed.data.priceRupees,
      parsed.data.departureTime,
      stops,
    );
    revalidatePath('/agency/routes');
    updateTag(agencyReportTag(agency.id)); // route price feeds dashboard revenue-by-route
    return {
      message: replaced
        ? 'Route updated.'
        : 'Price and time updated. Pickup stops are locked because this route already has bookings.',
    };
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
}

/**
 * Create a DRIVER login account (email + password) owned by this agency. Drivers
 * can't self-register — only the agency makes their account. Uses the service-role
 * admin client to create a confirmed auth user (role=DRIVER), then links a drivers
 * row to the agency. On any failure after user creation, the user is removed so
 * the email stays reusable.
 */
export async function createDriverAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = driverSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please complete the driver form.' };
  }
  const db = await createClient();
  const d = parsed.data;
  try {
    const agency = await requireApprovedAgency(db);
    const admin = createAdminClient();

    const free = await ensureEmailFreeForSignup(admin, d.email);
    if (free.error) return { error: free.error };

    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email: d.email,
      password: d.password,
      email_confirm: true, // agency-vouched — can log in immediately, no email step
      user_metadata: { role: 'DRIVER', full_name: d.name, phone: d.phone ?? '' },
    });
    if (cErr || !created.user) {
      return { error: cErr?.message ?? 'Could not create the driver account.' };
    }
    const uid = created.user.id;

    // The handle_new_user trigger creates the profile (role DRIVER + name + email);
    // set the phone, then link the driver to this agency.
    const { error: pErr } = await admin
      .from('profiles')
      .update({ full_name: d.name, phone: d.phone || null })
      .eq('id', uid);
    if (pErr) {
      await admin.auth.admin.deleteUser(uid); // roll back so the email is reusable
      throw new AppError('DRIVER', pErr.message);
    }
    const { error: dErr } = await admin.from('drivers').insert({
      agency_id: agency.id,
      profile_id: uid,
      license_no: d.licenseNo || null,
      aadhaar_no: d.aadhaarNo || null,
      address: d.address || null,
      blood_group: d.bloodGroup || null,
      dob: d.dob || null,
      alt_phone: d.altPhone || null,
      is_active: true,
    });
    if (dErr) {
      await admin.auth.admin.deleteUser(uid); // roll back so the email is reusable
      throw new AppError('DRIVER', dErr.message);
    }
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  revalidatePath('/agency/drivers');
  // A new driver is immediately eligible as an unassigned/substitute driver, so
  // refresh the bus driver dropdowns (add-bus + edit-bus cards) that list them.
  revalidatePath('/agency/buses');
  revalidatePath('/agency/add-bus');
  return { message: `Driver account created for ${d.email}. Share these credentials with the driver.` };
}

/** Edit a driver owned by this agency: profile/licence/active, optional email + password. */
export async function updateDriverAction(_: FormState, formData: FormData): Promise<FormState> {
  const driverId = String(formData.get('driverId') ?? '');
  if (!driverId) return { error: 'Missing driver reference.' };
  const parsed = driverEditSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please check the details.' };
  }
  const db = await createClient();
  const d = parsed.data;
  try {
    const agency = await requireApprovedAgency(db);
    // Confirm the driver belongs to this agency + get their login (profile) id —
    // targeted lookup (migration 0065), not a full-roster scan.
    const { data: rows } = await db.rpc('agency_driver', { p_agency_id: agency.id, p_driver_id: driverId });
    const row = ((rows ?? []) as { driver_id: string; profile_id: string | null; email: string | null }[])[0];
    if (!row) return { error: 'Driver not found for this agency.' };
    const uid = row.profile_id;
    if (!uid) return { error: 'This driver is not linked to a login account.' };

    const admin = createAdminClient();
    // Email change (auth + profile), only if actually different.
    if (d.email.toLowerCase() !== (row.email ?? '').toLowerCase()) {
      const free = await ensureEmailFreeForSignup(admin, d.email);
      if (free.error) return { error: free.error };
      const { error: eMail } = await admin.auth.admin.updateUserById(uid, {
        email: d.email,
        email_confirm: true,
      });
      if (eMail) return { error: eMail.message };
    }
    // Optional password reset.
    if (d.password) {
      const { error: ePw } = await admin.auth.admin.updateUserById(uid, { password: d.password });
      if (ePw) return { error: ePw.message };
    }
    const { error: ePr } = await admin
      .from('profiles')
      .update({ full_name: d.name, phone: d.phone || null, email: d.email })
      .eq('id', uid);
    // If the auth email already changed but the profile write failed, surface it
    // — otherwise profiles.email/full_name/phone diverge from the login while we
    // report "Driver updated." (createDriverAction guards this too.)
    if (ePr) throw new AppError('DRIVER', ePr.message);
    const { error: eDrv } = await admin
      .from('drivers')
      .update({
        license_no: d.licenseNo || null,
        aadhaar_no: d.aadhaarNo || null,
        address: d.address || null,
        blood_group: d.bloodGroup || null,
        dob: d.dob || null,
        alt_phone: d.altPhone || null,
        is_active: d.isActive === 'true',
      })
      .eq('id', driverId)
      .eq('agency_id', agency.id);
    if (eDrv) throw new AppError('DRIVER', eDrv.message);
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  revalidatePath('/agency/drivers');
  return { message: 'Driver updated.' };
}

/** Soft-delete a driver: hide from Manage Drivers, move to Deleted Drivers, and
 *  unassign them from any bus. Reversible via restoreDriverAction. */
export async function softDeleteDriverAction(formData: FormData): Promise<void> {
  const driverId = String(formData.get('driverId') ?? '');
  if (!UUID_RE.test(driverId)) return; // malformed id → no-op, not a 22P02 crash
  const db = await createClient();
  const agency = await getMyAgency(db);
  if (!agency) return;
  const admin = createAdminClient();
  const { error: eDrv } = await admin
    .from('drivers')
    .update({ is_deleted: true, is_active: false, deleted_at: new Date().toISOString() })
    .eq('id', driverId)
    .eq('agency_id', agency.id);
  if (eDrv) throw new AppError('AGENCY', eDrv.message);
  // A removed driver must not stay assigned to a bus — surface a failure here too
  // so we never report success while the driver is still on a vehicle.
  const { error: eVeh } = await admin
    .from('vehicles')
    .update({ driver_id: null })
    .eq('driver_id', driverId)
    .eq('agency_id', agency.id);
  if (eVeh) throw new AppError('AGENCY', eVeh.message);
  revalidatePath('/agency/drivers');
  revalidatePath('/agency/deleted-drivers');
  revalidatePath('/agency/buses');
}

/** Restore a soft-deleted driver back to the active roster. */
export async function restoreDriverAction(formData: FormData): Promise<void> {
  const driverId = String(formData.get('driverId') ?? '');
  if (!UUID_RE.test(driverId)) return;
  const db = await createClient();
  const agency = await getMyAgency(db);
  if (!agency) return;
  const admin = createAdminClient();
  const { error } = await admin
    .from('drivers')
    .update({ is_deleted: false, is_active: true, deleted_at: null })
    .eq('id', driverId)
    .eq('agency_id', agency.id);
  if (error) throw new AppError('AGENCY', error.message);
  revalidatePath('/agency/drivers');
  revalidatePath('/agency/deleted-drivers');
}

/** HARD-delete a driver (from Deleted Drivers): permanently remove the drivers
 *  row AND their login/auth account. Irreversible. */
export async function hardDeleteDriverAction(formData: FormData): Promise<void> {
  const driverId = String(formData.get('driverId') ?? '');
  if (!UUID_RE.test(driverId)) return;
  const db = await createClient();
  const agency = await getMyAgency(db);
  if (!agency) return;
  const admin = createAdminClient();
  // Scope to this agency; only ever hard-delete something already soft-deleted.
  // A SELECT error must surface — otherwise it reads as "not found" and silently
  // no-ops, leaving the driver + their login in place while reporting success.
  const { data: row, error: readErr } = await admin
    .from('drivers')
    .select('profile_id, is_deleted')
    .eq('id', driverId)
    .eq('agency_id', agency.id)
    .maybeSingle();
  if (readErr) throw new AppError('AGENCY', readErr.message);
  if (!row || (row as { is_deleted: boolean }).is_deleted !== true) return;
  // Remove the driver row first (vehicles.driver_id / bus_driver_changes.driver_id
  // are ON DELETE SET NULL), then delete the login account for good.
  const { error } = await admin.from('drivers').delete().eq('id', driverId).eq('agency_id', agency.id);
  if (error) throw new AppError('AGENCY', error.message);
  const profileId = (row as { profile_id: string | null }).profile_id;
  if (profileId) await admin.auth.admin.deleteUser(profileId);
  revalidatePath('/agency/deleted-drivers');
  revalidatePath('/agency/drivers');
}

/**
 * Confirm/Reject can lose a race with the student (e.g. they cancel or pay at
 * the same moment). Instead of letting the RPC error crash to the error page,
 * catch it and land back on the list with a readable notice in the URL.
 */
async function decideBooking(
  formData: FormData,
  decide: (db: Awaited<ReturnType<typeof createClient>>, id: string) => Promise<void>,
): Promise<void> {
  const id = String(formData.get('bookingId') ?? '');
  if (!id) return;
  const db = await createClient();
  let notice: string | null = null;
  try {
    await decide(db, id);
  } catch (e) {
    notice = toErrorResponse(e).message;
  }
  // Refresh every surface a booking decision affects, not just Manage Booking —
  // the dashboard counts, View Booking, and the Manage Students roster all read
  // from the same bookings and were showing stale data until a manual reload.
  revalidatePath('/agency/bookings');
  revalidatePath('/agency/view-bookings');
  revalidatePath('/agency/students');
  revalidatePath('/agency');
  // The acting user is the agency owner; bust their own report cache.
  const agency = await getMyAgency(db);
  if (agency) updateTag(agencyReportTag(agency.id)); // dashboard bookings/revenue/students tiles
  if (notice) redirect(`/agency/bookings?notice=${encodeURIComponent(notice)}`);
}

export async function confirmBookingAction(formData: FormData): Promise<void> {
  await decideBooking(formData, confirmBooking);
}

export async function rejectBookingAction(formData: FormData): Promise<void> {
  await decideBooking(formData, rejectBooking);
}

export async function hideStudentAction(formData: FormData): Promise<void> {
  const studentId = String(formData.get('studentId') ?? '');
  if (!UUID_RE.test(studentId)) return;
  const db = await createClient();
  const agency = await getMyAgency(db);
  if (!agency) return;
  // Cancel this student's active bookings with the agency (frees seats) BEFORE
  // hiding, so we never hide a student while their seats are still held.
  const { data: rows, error: rowsErr } = await db
    .from('bookings')
    .select('id, route_id, status, routes!inner(agency_id)')
    .eq('student_id', studentId)
    .in('status', ['PENDING', 'CONFIRMED'])
    .eq('routes.agency_id', agency.id);
  // Surface a failure via the panel error boundary — consistent with the driver
  // void actions (the ?notice pattern was silent: the students page never renders
  // it). Don't hide the student unless the seats were actually freed.
  if (rowsErr) throw new AppError('AGENCY', rowsErr.message);
  // Route through services.rejectBooking, which THROWS on a failed RPC — db.rpc()
  // resolves with { error } and would NOT reject the Promise.all, so a genuine
  // cancel failure would otherwise slip through and hide the student with a seat
  // still reserved.
  await Promise.all((rows ?? []).map((b) => rejectBooking(db, b.id as string)));
  const { error: hideErr } = await db.from('agency_hidden_students').upsert({
    agency_id: agency.id,
    student_id: studentId,
  });
  if (hideErr) throw new AppError('AGENCY', hideErr.message);
  revalidatePath('/agency/students');
  revalidatePath('/agency/deleted-students');
  // Removing a student cancels their bookings (frees seats), so refresh the same
  // surfaces a booking decision does — the dashboard Active-students count/donut,
  // View Booking, and Manage Booking (their now-rejected PENDING request lingered
  // there) were stale until a manual reload.
  revalidatePath('/agency/bookings');
  revalidatePath('/agency/view-bookings');
  revalidatePath('/agency');
  updateTag(agencyReportTag(agency.id)); // dashboard students/bookings tiles
}

export async function restoreStudentAction(formData: FormData): Promise<void> {
  const studentId = String(formData.get('studentId') ?? '');
  if (!UUID_RE.test(studentId)) return;
  const db = await createClient();
  const agency = await getMyAgency(db);
  if (!agency) return;
  const { error } = await db
    .from('agency_hidden_students')
    .delete()
    .eq('agency_id', agency.id)
    .eq('student_id', studentId);
  if (error) throw new AppError('AGENCY', error.message); // consistent with driver actions
  revalidatePath('/agency/students');
  revalidatePath('/agency/deleted-students');
  updateTag(agencyReportTag(agency.id)); // restored student re-enters the dashboard counts
}
