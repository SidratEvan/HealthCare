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

// --- Staff: the second factor (pilot step 28, FR-SEC-10) ----------------------

/** Six digits from an authenticator app. */
export const totpCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/);

/**
 * `POST /staff/2fa`: the challenge `POST /staff/login` handed back, and a code
 * from the app — or one of the recovery codes (`xxxx-xxxx-xxxx`), which the
 * server tells apart by shape.
 */
export const staffTwoFactorBody = z.strictObject({
  challenge: z.string().min(20).max(2_000),
  code: z.string().trim().min(6).max(24),
});

/** `POST /staff/2fa/enable`: a code from the app, proving it holds the secret. */
export const staffTwoFactorEnableBody = z.strictObject({ code: totpCode });

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

/** `POST /guest/start` — the phone and name from `MOD-A07-GUEST`. */
export const guestStartBody = z.strictObject({
  phone: typedPhone,
  name: z.string().trim().min(1).max(120),
  /**
   * What `/guest/verify` gave this device for this number (decision 85): with
   * it, a returning guest on the same phone is not asked for a code again.
   */
  deviceProof: z.string().min(20).max(2000).optional(),
});

/** `POST /guest/verify` — the code from `MOD-GST-OTP`. */
export const guestVerifyBody = z.strictObject({
  phone: typedPhone,
  name: z.string().trim().min(1).max(120),
  code: z.string().regex(/^\d{6}$/),
});

export type StaffLoginBody = z.infer<typeof staffLoginBody>;
export type StaffRefreshBody = z.infer<typeof staffRefreshBody>;
export type StaffPasswordBody = z.infer<typeof staffPasswordBody>;
export type StaffTwoFactorBody = z.infer<typeof staffTwoFactorBody>;
export type StaffTwoFactorEnableBody = z.infer<typeof staffTwoFactorEnableBody>;
