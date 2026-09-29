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

export type StaffLoginBody = z.infer<typeof staffLoginBody>;
export type StaffRefreshBody = z.infer<typeof staffRefreshBody>;
export type StaffPasswordBody = z.infer<typeof staffPasswordBody>;
