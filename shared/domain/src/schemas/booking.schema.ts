/**
 * Request shapes for discovery and booking (BACKEND.md §7.2, §7.3).
 *
 * Shared by both sides: the API validates with these and the patient app
 * builds its forms from them, so a form cannot submit something the server
 * would reject — which a patient would otherwise discover at the confirm step,
 * after choosing a doctor and a time.
 */

import { z } from 'zod';

/** A UUID as it arrives on the wire, before it is branded. */
const uuid = z.string().uuid();

/**
 * A Bangladeshi mobile number, normalised (`DB-P6`).
 *
 * The same expression the database enforces, so a number that passes here
 * cannot be refused by a constraint afterwards. Validated rather than
 * normalised: a person who typed their number wrong should be told, not have
 * a different number saved for them.
 */
export const bdPhone = z
  .string()
  .trim()
  .regex(/^\+8801[3-9]\d{8}$/, 'must be a Bangladeshi mobile number, e.g. +8801712345678');

// ---------------------------------------------------------------------------
// Discovery (public)
// ---------------------------------------------------------------------------

export const hospitalQuery = z.object({
  district: z.string().trim().min(1).max(60).optional(),
  q: z.string().trim().min(1).max(80).optional(),
  // Bangladesh sits within these bounds; the same check `hospitals` carries,
  // because a coordinate outside them produces a confident wrong distance.
  lat: z.coerce.number().min(20).max(27).optional(),
  lng: z.coerce.number().min(87.5).max(93).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export const doctorQuery = z.object({
  specialty: z.string().trim().min(1).max(20).optional(),
  hospitalId: uuid.optional(),
  q: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export const sessionQuery = z.object({
  doctorId: uuid.optional(),
  hospitalId: uuid.optional(),
});

export const idParams = z.object({ id: uuid });

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

/** `SEG-A07C-PAY`. `at_hospital` is a first-class choice, not a fallback. */
export const paymentMethod = z.enum(['bkash', 'nagad', 'card', 'at_hospital']);

/**
 * What a guest supplies (`FR-GST-02`, `MOD-A07-GUEST`).
 *
 * "A guest supplies only what the task needs: name + phone number, plus age
 * and sex when a clinical record will be created." A booking creates one, so
 * all four are required here and nothing else is asked.
 */
export const guestDetails = z.object({
  name: z.string().trim().min(2).max(80),
  phone: bdPhone,
  ageYears: z.number().int().min(0).max(130),
  sex: z.enum(['male', 'female', 'other']),
});

/**
 * `POST /bookings`.
 *
 * Either an account holder naming one of their profiles, or a guest giving
 * their details. Never both — the union makes the ambiguous request
 * unrepresentable rather than something the server has to arbitrate.
 */
export const createBookingBody = z.object({
  sessionId: uuid,
  method: paymentMethod,
  patientId: uuid.optional(),
  guest: guestDetails.optional(),
  reason: z.string().trim().max(500).optional(),
  /** Pre-visit answers, so the doctor's screen is populated (`FR-DOC-03`). */
  intake: z.record(z.string(), z.unknown()).optional(),
});

/**
 * `GET /guest/link/:token` (`FR-GST-05`).
 *
 * Thirty-two random bytes, base64url — 43 characters. Bounded on both sides so
 * a path that could not possibly be a token is refused before it reaches a
 * hash and a query, and restricted to the base64url alphabet so nothing else
 * in a URL is mistaken for one.
 */
export const trackingLinkParams = z.object({
  token: z
    .string()
    .trim()
    .min(20)
    .max(200)
    .regex(/^[A-Za-z0-9_-]+$/, 'is not a tracking token'),
});

export type CreateBookingBody = z.infer<typeof createBookingBody>;
export type GuestDetails = z.infer<typeof guestDetails>;
export type PaymentMethodValue = z.infer<typeof paymentMethod>;
