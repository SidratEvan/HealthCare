/**
 * Request shapes for every queue endpoint (BACKEND.md §7.4).
 *
 * These live in `shared/domain` because they are one contract used by both
 * sides: the API validates with them, and the console builds its offline queue
 * out of the same types. A console that can construct a body the server would
 * reject is a console that discovers it at the end of a shift, with fifty
 * queued actions that cannot be replayed.
 *
 * No I/O, so this file stays inside the purity rule (BACKEND.md §2): zod is
 * types and functions, and the schemas are evaluated at module load with no
 * clock, network or filesystem involved.
 */

import { z } from 'zod';

import { MAX_DELAY_MINUTES, MAX_QUOTED_WAIT_MINUTES } from '../queue/rules.js';

/** A UUID as it arrives on the wire, before it is branded. */
const uuid = z.string().uuid();

/**
 * What every queue command carries besides its own fields.
 *
 * `clientEventId` is the idempotency key of the event itself (`FR-QUE-51`,
 * `SY-02`): a console that loses the response and re-sends must not advance
 * the queue twice. It is optional because a patient tapping "I'm running late"
 * in the app has no offline queue to replay, while a reception console always
 * supplies one.
 *
 * `clientTs` is the console's own clock. It may be hours stale after an
 * offline shift and orders a replayed batch *within itself only* — the server
 * clock decides real order, always (`SY-01`).
 */
export const queueCommandEnvelope = z.object({
  clientEventId: uuid.optional(),
  clientTs: z.string().datetime({ offset: true }).optional(),
});

export type QueueCommandEnvelope = z.infer<typeof queueCommandEnvelope>;

/** Extends the envelope with a command's own fields. */
function command<T extends z.ZodRawShape>(shape: T) {
  return queueCommandEnvelope.extend(shape);
}

// ---------------------------------------------------------------------------
// Session-wide commands
// ---------------------------------------------------------------------------

/**
 * `POST /sessions/:id/arrived` — the doctor is in the chamber (`FR-REC-02`).
 *
 * `arrivedAt` is deliberately absent: the server stamps it. Lateness against
 * the planned start is the punctuality figure an administrator is shown
 * (`FR-ADM-05`), and a figure a console could supply is a figure a console
 * could round in its own favour.
 */
export const doctorArrivedBody = command({});

/** `POST /sessions/:id/delay` — a declared delay (`FR-REC-03`). */
export const declareDelayBody = command({
  minutes: z.number().int().positive().max(MAX_DELAY_MINUTES),
  reason: z.string().trim().min(1).max(200).nullable().default(null),
  declaredBy: z.enum(['doctor', 'reception']),
});

/** `POST /sessions/:id/pause` — a prayer break, a meal, an emergency call. */
export const pauseSessionBody = command({
  reason: z.string().trim().min(1).max(200).nullable().default(null),
});

export const resumeSessionBody = command({});

/** `POST /sessions/:id/end` (`FR-REC-06`). */
export const endSessionBody = command({
  reason: z.string().trim().min(1).max(200).nullable().default(null),
});

/**
 * `POST /sessions/:id/next` — the single most-used control in the product.
 *
 * No body beyond the envelope. Which patient is finished and which is next are
 * both decisions the reducer makes from the current state, not choices a
 * console gets to send: two counters that each named "the next patient" would
 * name different ones (`FR-QUE-53`).
 */
export const callNextBody = command({});

// ---------------------------------------------------------------------------
// Patient commands
// ---------------------------------------------------------------------------

/**
 * `POST /bookings/:id/done`.
 *
 * `consultSeconds` is measured from the call, never typed (`FR-REC-11`), so it
 * is not in the body. It feeds the rolling rate every ETA is built from
 * (`FR-QUE-12`); a typed value would be a guess entering the maths as a fact.
 */
export const markDoneBody = command({});

/** `POST /bookings/:id/late` — the patient says they are running late. */
export const markLateBody = command({
  expectedMinutes: z.number().int().positive().max(240),
});

/** `POST /bookings/:id/no-show` (`FR-QUE-20`). */
export const markNoShowBody = command({});

/** `POST /bookings/:id/reinstate` — a late patient returns (`FR-QUE-21`). */
export const reinstateBody = command({});

/**
 * `POST /bookings/:id/check-in` — the patient is at the counter (`FR-REC-18`).
 *
 * The quote is the console's to send, because reception may have changed the
 * pre-filled figure. The arrival time is not: the server stamps it, for the
 * same reason `DOCTOR_ARRIVED` takes no `arrivedAt` from a route.
 */
export const checkInBody = command({
  quotedWaitMinutes: z.number().int().min(0).max(MAX_QUOTED_WAIT_MINUTES),
});

/** `POST /sessions/:id/walkin` — reception adds someone at the counter. */
export const addWalkinBody = command({
  patientId: uuid,
  position: z.enum(['end', 'index']).default('end'),
  index: z.number().int().nonnegative().nullable().default(null),
  /** Required when inserting anywhere but the end (`FR-REC-14`). */
  reason: z.string().trim().min(1).max(200).nullable().default(null),
}).refine(
  (value) => value.position !== 'index' || (value.index !== null && value.reason !== null),
  {
    message: 'Inserting a walk-in at a position needs both an index and a reason (FR-REC-14).',
    path: ['reason'],
  },
);

/**
 * `POST /sessions/:id/reorder` — priority (`FR-REC-15`).
 *
 * The reason is mandatory and not nullable, unlike every other reason in this
 * file. Moving one patient ahead of another is the queue action most open to
 * abuse, so it is the one that must always be explicable afterwards.
 */
export const reorderBody = command({
  bookingId: uuid,
  toIndex: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(200),
});

/**
 * `POST /bookings/:id/cancel` (`FR-PAT-23`, BACKEND.md §7.3).
 *
 * The reason is optional on the wire and never null on the row. `MOD-A08-CANCEL`
 * is a confirm step, not a form — `APP_FLOW.md` A5 asks the patient nothing but
 * "are you sure, and here is the refund rule" — so the app sends no reason and
 * the service records who cancelled instead. Reception, which does have a
 * reason, may send one.
 *
 * It matters that something is recorded either way: `bookings.cancelled_reason`
 * is NOT NULL for a cancelled row, and both the refund rule (`FR-PAY-03`) and
 * the no-show loss figure (`FR-ADM-03`) read it.
 */
export const cancelBookingBody = command({
  reason: z.string().trim().min(1).max(200).nullable().default(null),
});

/** `POST /events/:id/undo` (`GR-02`). */
export const undoBody = command({});

/**
 * `POST /bookings/:id/offer-slot` (`FR-QUE-30`, `BTN-B02-OFFER`).
 *
 * No fields of its own. Which standby patient is next is the server's
 * decision, taken under the session lock — a body naming one would let two
 * counters offer the same chair to the same person — and the acceptance
 * window is `SLOT_OFFER_WINDOW_MINUTES`, not something a console proposes.
 */
export const offerSlotBody = command({});

/**
 * `POST /offers/:id/accept` (`FR-QUE-30`).
 *
 * Also empty. The serial the accepting patient gets depends on how the chair
 * came free and on where the queue has reached, which only the server knows,
 * and the fee comes from the session (`DB-P5`) rather than from the request.
 */
export const acceptOfferBody = command({});

// ---------------------------------------------------------------------------
// Params and query
// ---------------------------------------------------------------------------

export const sessionParams = z.object({ id: uuid });
export const bookingParams = z.object({ id: uuid });
export const eventParams = z.object({ id: uuid });
export const offerParams = z.object({ id: uuid });

/** `GET /sessions/:id/queue?sinceSeq=` — the resume handshake (`SY-01`). */
export const queueQuery = z.object({
  sinceSeq: z.coerce.number().int().nonnegative().optional(),
});

export type DeclareDelayBody = z.infer<typeof declareDelayBody>;
export type PauseSessionBody = z.infer<typeof pauseSessionBody>;
export type EndSessionBody = z.infer<typeof endSessionBody>;
export type MarkLateBody = z.infer<typeof markLateBody>;
export type AddWalkinBody = z.infer<typeof addWalkinBody>;
export type ReorderBody = z.infer<typeof reorderBody>;
export type OfferSlotBody = z.infer<typeof offerSlotBody>;
export type AcceptOfferBody = z.infer<typeof acceptOfferBody>;
