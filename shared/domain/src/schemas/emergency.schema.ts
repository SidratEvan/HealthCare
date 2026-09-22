/**
 * Request shapes for the emergency endpoints (BACKEND.md §7.5).
 *
 * Shared for the reason `bed.schema.ts` is: the ER console queues actions
 * offline (`FR-OFF-01`) and replays them later, and the patient app sends an
 * alert from a phone that may retry it — a body either can build but the
 * server rejects is one discovered at the worst possible moment.
 */

import { z } from 'zod';

import {
  BED_KINDS,
  CAPABILITY_KINDS,
  EMERGENCY_PROBLEMS,
  SEXES,
  TRIAGE_COLORS,
} from '../types/enums.js';

import { bdPhone } from './booking.schema.js';
import { queueCommandEnvelope } from './queue.schema.js';

const uuid = z.string().uuid();

export const emergencyProblem = z.enum(EMERGENCY_PROBLEMS);
export const triageColor = z.enum(TRIAGE_COLORS);
export const capabilityKind = z.enum(CAPABILITY_KINDS);

/**
 * A position in Bangladesh, as the phone reports it.
 *
 * The same bounds `hospitals_lat_in_bangladesh` holds a facility to. A
 * coordinate outside them is a phone's error or a spoof, and a travel time
 * computed from it is a confident wrong answer (`PRD.md` §3.2).
 */
const latitude = z.coerce.number().min(20).max(27);
const longitude = z.coerce.number().min(88).max(93);

/**
 * `GET /emergency/search` (`S-A-10b`, `FR-PAT-43`).
 *
 * Every field is optional, because every one of them may be missing in an
 * emergency: a critical case's first screen has no problem chosen yet
 * (`FR-PAT-41`), and a phone that refused location has no position. A search
 * without a position still answers — ranked on everything but distance, and
 * saying so.
 *
 * `from` searches from a hospital's own coordinates and leaves that hospital
 * out: the ER console's refer-out suggestion after a decline (`FR-EMG-02`).
 */
export const emergencySearchQuery = z
  .object({
    lat: latitude.optional(),
    lng: longitude.optional(),
    problem: emergencyProblem.optional(),
    from: uuid.optional(),
  })
  .refine((query) => (query.lat === undefined) === (query.lng === undefined), {
    message: 'Give both lat and lng, or neither.',
    path: ['lat'],
  })
  .refine((query) => query.from === undefined || query.lat === undefined, {
    message: 'Search from a hospital or from a position, not both.',
    path: ['from'],
  });

/**
 * `POST /emergency/inbound` — `BTN-A10-ONWAY`, "I'm on my way" (`FR-PAT-46`).
 *
 * Nothing about the person is required (`FR-GST-03`, `APP_FLOW.md` A1.4:
 * "leaving it blank still sends the inbound alert"). The position is used for
 * the ETA and then discarded; it is never stored.
 */
export const inboundBody = z.object({
  hospitalId: uuid,
  problem: emergencyProblem,
  lat: latitude.nullable().default(null),
  lng: longitude.nullable().default(null),
  phone: bdPhone.nullable().default(null),
  ageYears: z.number().int().min(0).max(130).nullable().default(null),
  sex: z.enum(SEXES).nullable().default(null),
});

/**
 * The envelope every console command carries: `clientEventId` and `clientTs`,
 * as the queue and the ward have them. A walk-in's `clientEventId` becomes the
 * case's `idempotency_key`, which is what makes a replayed registration find
 * the person it already made (SY-02).
 */
export const emergencyCommandEnvelope = queueCommandEnvelope;

/** `POST /emergency/cases` — walk-in registration, straight into the triage list. */
export const walkInBody = emergencyCommandEnvelope.extend({
  problem: emergencyProblem,
  triage: triageColor.nullable().default(null),
  phone: bdPhone.nullable().default(null),
  ageYears: z.number().int().min(0).max(130).nullable().default(null),
  sex: z.enum(SEXES).nullable().default(null),
});

export const emergencyCaseParams = z.object({ id: uuid });

/** `POST /emergency/cases/:id/acknowledge` — `BTN-B07-PREPARE`. */
export const acknowledgeBody = emergencyCommandEnvelope;

/**
 * `PATCH /emergency/cases/:id` — "triage, state" (BACKEND.md §7.5).
 *
 * A discriminated union rather than a bag of optional fields, so a request
 * says exactly one thing it wants done and the guard in `emergency/cases.ts`
 * can be asked about exactly that.
 */
export const caseCommandBody = z.discriminatedUnion('action', [
  emergencyCommandEnvelope.extend({ action: z.literal('accept') }),
  emergencyCommandEnvelope.extend({
    action: z.literal('decline'),
    reason: z.string().trim().min(1).max(300),
  }),
  emergencyCommandEnvelope.extend({ action: z.literal('triage'), triage: triageColor }),
  emergencyCommandEnvelope.extend({ action: z.literal('handoff'), bedKind: z.enum(BED_KINDS) }),
  emergencyCommandEnvelope.extend({ action: z.literal('discharge') }),
]);

/**
 * `PUT /hospitals/:id/capabilities` — `SW-B07-<capability>` (`FR-EMG-05`).
 *
 * The coordinator confirms the whole list, not one switch: every row named is
 * written with this person and this instant, so re-sending an unchanged list
 * is how a coordinator says "still true" and the freshness a patient sees is
 * renewed. A kind the hospital has never declared is refused — adding a
 * capability is the hospital administrator's setup, not an ER toggle.
 */
export const capabilitiesBody = emergencyCommandEnvelope.extend({
  capabilities: z
    .array(z.object({ kind: capabilityKind, available: z.boolean() }))
    .min(1)
    .max(CAPABILITY_KINDS.length)
    .refine(
      (entries) => new Set(entries.map((entry) => entry.kind)).size === entries.length,
      'Each capability may appear once.',
    ),
});

export const hospitalEmergencyParams = z.object({ id: uuid });

/**
 * `GET /emergency/track/:token` and its cancel — the family's view of the
 * alert they sent (`S-A-10c`). The token is the credential, as with the SMS
 * tracking link (`FR-GST-05`): signed, expiring, scoped to one case.
 */
export const emergencyTokenParams = z.object({
  token: z
    .string()
    .trim()
    .min(20)
    .max(2000)
    .regex(/^[A-Za-z0-9_.-]+$/, 'is not a case token'),
});

export type EmergencySearchQuery = z.infer<typeof emergencySearchQuery>;
export type InboundBody = z.infer<typeof inboundBody>;
export type WalkInBody = z.infer<typeof walkInBody>;
export type CaseCommandBody = z.infer<typeof caseCommandBody>;
export type CapabilitiesBody = z.infer<typeof capabilitiesBody>;
