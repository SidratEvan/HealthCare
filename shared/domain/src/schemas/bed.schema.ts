/**
 * Request shapes for the bed endpoints (BACKEND.md §7.5).
 *
 * Shared for the reason `queue.schema.ts` is: the ward console queues actions
 * offline and replays them later (`FR-OFF-01`), and a body the console can
 * build but the server rejects is one discovered at the end of a shift.
 */

import { z } from 'zod';

import { MAX_HOLD_MINUTES } from '../beds/board.js';
import { BED_KINDS } from '../types/enums.js';

import { guestDetails } from './booking.schema.js';
import { queueCommandEnvelope } from './queue.schema.js';

const uuid = z.string().uuid();

/** A calendar date, `YYYY-MM-DD`, as the ward means it — Dhaka's. */
const dhakaDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

/**
 * `clientEventId` and `clientTs`, exactly as the queue has them.
 *
 * `clientEventId` becomes `bed_events.client_event_id`, unique, which is what
 * makes a replayed admit a no-op rather than a second patient (SY-02).
 */
export const bedCommandEnvelope = queueCommandEnvelope;

function command<T extends z.ZodRawShape>(shape: T) {
  return bedCommandEnvelope.extend(shape);
}

export const bedParams = z.object({ id: uuid });
export const hospitalBedsParams = z.object({ id: uuid });

export const bedKind = z.enum(BED_KINDS);

/**
 * `POST /beds/:id/admit` (`BTN-B06-ADMIT`).
 *
 * "Patient search or from pending list." Exactly one of the two:
 *
 *   - `bedRequestId`, admitting the family a request in `LIST-B06-PENDING`
 *     named; or
 *   - `patient`, the person at the ward desk: name, phone, age, sex. An
 *     existing profile with the same phone and name is reused rather than
 *     duplicated (`FR-GST-12`, `FR-GST-13`).
 *
 * There is no free-text patient search. A ward console that could look anyone
 * up by phone would be reading records of people who have never been to this
 * hospital (DATABASE.md §5), so the desk types what it already knows and the
 * server finds the match.
 *
 * `emergencyCaseId` places a case the ER handed over (`BTN-B07-ADMIT`,
 * `FR-BED-07`). It comes *with* a `patient`: an ER case is usually anonymous
 * until now, and a stay needs somebody's name — the ward takes it at the bed,
 * as it would for anybody at the desk.
 */
export const admitBedBody = command({
  bedRequestId: uuid.nullable().default(null),
  emergencyCaseId: uuid.nullable().default(null),
  patient: guestDetails.nullable().default(null),
  expectedDischargeDate: dhakaDate.nullable().default(null),
})
  .refine((body) => (body.bedRequestId === null) !== (body.patient === null), {
    message: 'Admit either a pending request or a named patient, not both and not neither.',
    path: ['bedRequestId'],
  })
  .refine((body) => body.emergencyCaseId === null || body.patient !== null, {
    message: 'An ER case is admitted with the name the ward takes at the bed.',
    path: ['patient'],
  });

export const dischargeBedBody = command({});

/** `POST /beds/:id/transfer` — this bed to `toBedId` (`BTN-B06-TRANSFER`). */
export const transferBedBody = command({ toBedId: uuid });

/** `POST /beds/:id/reserve` — "hold with expiry" (`BTN-B06-RESERVE`). */
export const reserveBedBody = command({
  minutes: z.number().int().positive().max(MAX_HOLD_MINUTES),
});

export const releaseBedBody = command({});
export const cleanStartBody = command({});
export const cleanDoneBody = command({});

/** `POST /beds/:id/oos` — "marks out of service with reason" (`BTN-B06-OOS`). */
export const outOfServiceBody = command({
  reason: z.string().trim().min(1).max(200),
});

export const restoreBedBody = command({});

/** `POST /beds/:id/expected-discharge` (`SEL-B06-EXPDIS`, `FR-BED-04`). Null clears it. */
export const expectedDischargeBody = command({
  date: dhakaDate.nullable(),
});

// ---------------------------------------------------------------------------
// Bed requests (`FR-PAT-52`, `FR-BED-07`)
// ---------------------------------------------------------------------------

/**
 * `POST /bed-requests` — `MOD-A11-REQUEST`: "patient profile, expected
 * arrival, condition note".
 *
 * The patient is given the way a guest booking gives one (`FR-GST-01`): no
 * account needed. The OTP `FR-GST-03` asks for is deferred with the rest of
 * authentication (CLAUDE.md §4.1).
 */
export const createBedRequestBody = z.object({
  hospitalId: uuid,
  bedKind,
  patient: guestDetails,
  expectedArrivalAt: z.string().datetime({ offset: true }).nullable().default(null),
  note: z.string().trim().max(500).nullable().default(null),
});

/** `POST /bed-requests/:id/respond` — hold, confirm, or decline. */
export const respondBedRequestBody = z.discriminatedUnion('action', [
  bedCommandEnvelope.extend({
    action: z.literal('hold'),
    bedId: uuid,
    minutes: z.number().int().positive().max(MAX_HOLD_MINUTES),
  }),
  bedCommandEnvelope.extend({
    // Confirmed means admitted: the family is here and in a bed. Held beds
    // are admitted into; `bedId` names the bed when there was no hold.
    action: z.literal('confirm'),
    bedId: uuid.nullable().default(null),
  }),
  bedCommandEnvelope.extend({ action: z.literal('decline') }),
]);

/**
 * `GET /bed-requests/track/:token` — the family's view of their request.
 *
 * The token in the path is the credential, as with the SMS tracking link
 * (`FR-GST-05`): a signed, expiring capability scoped to one request.
 */
export const bedRequestTokenParams = z.object({
  token: z
    .string()
    .trim()
    .min(20)
    .max(2000)
    .regex(/^[A-Za-z0-9_.-]+$/, 'is not a request token'),
});

export type AdmitBedBody = z.infer<typeof admitBedBody>;
export type TransferBedBody = z.infer<typeof transferBedBody>;
export type ReserveBedBody = z.infer<typeof reserveBedBody>;
export type OutOfServiceBody = z.infer<typeof outOfServiceBody>;
export type ExpectedDischargeBody = z.infer<typeof expectedDischargeBody>;
export type CreateBedRequestBody = z.infer<typeof createBedRequestBody>;
export type RespondBedRequestBody = z.infer<typeof respondBedRequestBody>;
