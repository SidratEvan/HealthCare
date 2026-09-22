/**
 * Request shapes for the referral endpoints (BACKEND.md §7.5, `FR-EMG-07..09`).
 *
 * Shared for the reason `emergency.schema.ts` is: both ER consoles queue their
 * referral actions offline (`FR-OFF-01`) and replay them later, and a body a
 * console can build but the server rejects is one discovered at the worst
 * possible moment.
 */

import { z } from 'zod';

import { REFERRAL_NOTE_MAX } from '../emergency/referrals.js';
import { BED_KINDS, CAPABILITY_KINDS } from '../types/enums.js';

import { emergencyCommandEnvelope } from './emergency.schema.js';

const uuid = z.string().uuid();

/**
 * `POST /referrals` — `BTN-B07-REFER-SEND-<hospitalId>` (`FR-EMG-08`).
 *
 * The summary's problem, colour, age and sex are read from the case on the
 * server, not sent: a referral says what the case says, and a console cannot
 * tell a second hospital something its own record does not. What the console
 * adds is what the case is referred *for* — a capability, a kind of bed, or
 * both (`referrals_asks_for_something`) — and a short note.
 *
 * The note is trimmed, and an empty one is no note.
 */
export const referralSendBody = emergencyCommandEnvelope
  .extend({
    emergencyCaseId: uuid,
    toHospitalId: uuid,
    requiredCapability: z.enum(CAPABILITY_KINDS).nullable().default(null),
    requiredBedKind: z.enum(BED_KINDS).nullable().default(null),
    note: z
      .string()
      .trim()
      .max(REFERRAL_NOTE_MAX)
      .nullable()
      .default(null)
      .transform((value) => (value === null || value === '' ? null : value)),
  })
  .refine((body) => body.requiredCapability !== null || body.requiredBedKind !== null, {
    message: 'Say what the referral asks for: a capability, a kind of bed, or both.',
    path: ['requiredCapability'],
  });

export const referralParams = z.object({ id: uuid });

/**
 * `POST /referrals/:id/seen`, `/accept`, `/cancel`, `/arrive` — each carries
 * only the envelope. A replay is answered by the referral's state
 * (`referralAlreadyApplied`), so the envelope is for ordering and logging.
 */
export const referralActionBody = emergencyCommandEnvelope;

/** `POST /referrals/:id/decline` — "reason required on decline" (BACKEND.md §7.5). */
export const referralDeclineBody = emergencyCommandEnvelope.extend({
  reason: z.string().trim().min(1).max(300),
});

export type ReferralSendBody = z.infer<typeof referralSendBody>;
export type ReferralDeclineBody = z.infer<typeof referralDeclineBody>;
