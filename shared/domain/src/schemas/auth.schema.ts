/**
 * Request shapes for staff sign-in (pilot step 21, BACKEND.md §7.1).
 *
 * Shared by the API, which validates with them, and the console, which builds
 * `S-B-00` from them — so the form cannot submit what the server would refuse.
 * Strict objects: a stray field is a 400, not something silently ignored.
 */

import { z } from 'zod';

/** An email as staff type it: trimmed, and long enough to be one. */
const email = z.string().trim().min(3).max(254).includes('@');

/**
 * A password as typed. Its only upper bound is a sanity one: scrypt reads the
 * whole string, and a megabyte of it is a denial of service, not a password.
 */
const password = z.string().min(1).max(200);

/** `hospitals.code` (0027): letters, digits and hyphens, matched upper-case. */
export const hospitalCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]{1,15}$/)
  .transform((value) => value.toUpperCase());

/** `POST /staff/login`. `hospitalCode` only when the server asked for it. */
export const staffLoginBody = z.strictObject({
  email,
  password,
  hospitalCode: hospitalCode.optional(),
});

/** `POST /staff/refresh` and `POST /staff/logout` — the opaque refresh token. */
export const staffRefreshBody = z.strictObject({
  refresh: z.string().min(20).max(200),
});

/** `POST /staff/password`. */
export const staffPasswordBody = z.strictObject({
  current: password,
  next: password,
});

// --- Patients: phone and a one-time code (pilot step 25, FR-PAT-01) ---------

/** A phone as the patient types it; the server normalises it or refuses it (`DB-P6`). */
const typedPhone = z.string().trim().min(10).max(20);

/** `POST /auth/otp`. */
export const otpRequestBody = z.strictObject({ phone: typedPhone });

/** `POST /auth/verify`. Six Latin digits; the app converts Bengali ones as typed. */
export const otpVerifyBody = z.strictObject({
  phone: typedPhone,
  code: z.string().regex(/^\d{6}$/),
});

/** `POST /auth/refresh` and `POST /auth/logout`. */
export const patientRefreshBody = z.strictObject({ refresh: z.string().min(20).max(200) });

/** `POST /guest/claim`: without `confirm`, the preview; with it, the claim (`FR-GST-09`). */
export const claimBody = z.strictObject({ confirm: z.boolean().default(false) });

export type StaffLoginBody = z.infer<typeof staffLoginBody>;
export type StaffRefreshBody = z.infer<typeof staffRefreshBody>;
export type StaffPasswordBody = z.infer<typeof staffPasswordBody>;
