/**
 * Queue routes (BACKEND.md §7.4).
 *
 * Every row of that table, in that order. A route here does four things and no
 * more: require authentication, require a role, validate the shape, hand off
 * to a controller. Anything that looks like a decision belongs one layer down.
 *
 * ## Why every write demands an idempotency key
 *
 * `idempotency({ required: true })` on all of them. A reception console runs
 * offline for a whole shift and replays what it queued when the signal comes
 * back (`FR-OFF-01`, `FR-QUE-51`); a request that could be applied twice is a
 * patient called twice, or a no-show recorded against somebody who was there.
 * The key is cheap for the client to produce and the only thing that makes
 * replay safe.
 *
 * ## Why the roles are what they are
 *
 * `FR-ROLE-01` scopes every role to a hospital, and the controller checks the
 * session belongs to the caller's. The role list here is the coarser question
 * of *what kind of person* may do a thing at all: a doctor may declare arrival
 * and finish a patient, but marking a no-show or reordering the line is
 * reception's job and is recorded against reception.
 */

import { Router } from 'express';

import {
  addWalkinBody,
  acceptOfferBody,
  bookingParams,
  callNextBody,
  checkInBody,
  declareDelayBody,
  doctorArrivedBody,
  endSessionBody,
  eventParams,
  markDoneBody,
  markLateBody,
  markNoShowBody,
  offerParams,
  offerSlotBody,
  pauseSessionBody,
  queueQuery,
  reinstateBody,
  reorderBody,
  resumeSessionBody,
  sessionParams,
  undoBody,
} from '@platform/domain';

import * as queue from '../controllers/queue.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { idempotency } from '../middleware/idempotency.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate } from '../middleware/validate.js';

export const queueRoutes: Router = Router();

/** Every write on this router is replay-safe or it is not accepted. */
const write = idempotency({ required: true });

// --- Reading -----------------------------------------------------------------

queueRoutes.get(
  '/sessions/:id/queue',
  requireAuth,
  requireRole('receptionist', 'doctor', 'hospital_admin'),
  validate({ params: sessionParams, query: queueQuery }),
  queue.getQueue,
);

// --- Session lifecycle -------------------------------------------------------

queueRoutes.post(
  '/sessions/:id/arrived',
  requireAuth,
  requireRole('receptionist', 'doctor'),
  write,
  validate({ params: sessionParams, body: doctorArrivedBody }),
  queue.declareArrived,
);

queueRoutes.post(
  '/sessions/:id/delay',
  requireAuth,
  requireRole('receptionist', 'doctor'),
  write,
  validate({ params: sessionParams, body: declareDelayBody }),
  queue.declareDelay,
);

queueRoutes.post(
  '/sessions/:id/pause',
  requireAuth,
  requireRole('receptionist'),
  write,
  validate({ params: sessionParams, body: pauseSessionBody }),
  queue.pauseSession,
);

queueRoutes.post(
  '/sessions/:id/resume',
  requireAuth,
  requireRole('receptionist'),
  write,
  validate({ params: sessionParams, body: resumeSessionBody }),
  queue.resumeSession,
);

queueRoutes.post(
  '/sessions/:id/end',
  requireAuth,
  requireRole('receptionist'),
  write,
  validate({ params: sessionParams, body: endSessionBody }),
  queue.endSession,
);

// --- Moving the queue --------------------------------------------------------

/** The most-used control in the product (`FR-REC-01`). */
queueRoutes.post(
  '/sessions/:id/next',
  requireAuth,
  requireRole('receptionist', 'doctor'),
  write,
  validate({ params: sessionParams, body: callNextBody }),
  queue.callNext,
);

queueRoutes.post(
  '/bookings/:id/done',
  requireAuth,
  requireRole('receptionist', 'doctor'),
  write,
  validate({ params: bookingParams, body: markDoneBody }),
  queue.markDone,
);

/**
 * Lateness is declared by the counter *or* by the patient (`FR-PAT-33`).
 *
 * `requireAuth` without `requireRole`: the controller distinguishes a
 * receptionist from the patient themselves and checks booking ownership, and
 * the actor recorded on the event says which of them it was (`FR-QUE-04`).
 */
queueRoutes.post(
  '/bookings/:id/late',
  requireAuth,
  write,
  validate({ params: bookingParams, body: markLateBody }),
  queue.markLate,
);

queueRoutes.post(
  '/bookings/:id/no-show',
  requireAuth,
  requireRole('receptionist'),
  write,
  validate({ params: bookingParams, body: markNoShowBody }),
  queue.markNoShow,
);

queueRoutes.post(
  '/bookings/:id/reinstate',
  requireAuth,
  requireRole('receptionist'),
  write,
  validate({ params: bookingParams, body: reinstateBody }),
  queue.reinstate,
);

/**
 * The patient is here, and was quoted a wait (`FR-REC-18`). Reception's: it is
 * said across the counter, by the person who can see who is standing there.
 */
queueRoutes.post(
  '/bookings/:id/check-in',
  requireAuth,
  requireRole('receptionist'),
  write,
  validate({ params: bookingParams, body: checkInBody }),
  queue.checkIn,
);

queueRoutes.post(
  '/sessions/:id/walkin',
  requireAuth,
  requireRole('receptionist'),
  write,
  validate({ params: sessionParams, body: addWalkinBody }),
  queue.addWalkin,
);

/** Reason mandatory, and recorded (`FR-REC-15`). */
queueRoutes.post(
  '/sessions/:id/reorder',
  requireAuth,
  requireRole('receptionist'),
  write,
  validate({ params: sessionParams, body: reorderBody }),
  queue.reorder,
);

// --- Freed slots and the standby list (FR-QUE-30, FR-REC-30) -----------------
//
// Reception's, not a doctor's: giving a chair away and recording who took it
// is counter work, and the offer is raised from the row the receptionist has
// just settled. `hospital_admin` reads the list because `FR-ADM-03`'s recovery
// figure is built from it and an administrator checking the number should be
// able to see the offers behind it.

queueRoutes.get(
  '/sessions/:id/standby',
  requireAuth,
  requireRole('receptionist', 'hospital_admin'),
  validate({ params: sessionParams }),
  queue.getStandby,
);

queueRoutes.post(
  '/bookings/:id/offer-slot',
  requireAuth,
  requireRole('receptionist'),
  write,
  validate({ params: bookingParams, body: offerSlotBody }),
  queue.offerSlot,
);

queueRoutes.post(
  '/offers/:id/accept',
  requireAuth,
  requireRole('receptionist'),
  write,
  validate({ params: offerParams, body: acceptOfferBody }),
  queue.acceptOffer,
);

// --- Undo --------------------------------------------------------------------

/**
 * Ten seconds, and only the actor who did it (`GR-02`).
 *
 * No `requireRole`: a patient who cancels by mistake has the same ten seconds
 * a receptionist does, and the controller enforces that it is the same person.
 */
queueRoutes.post(
  '/events/:id/undo',
  requireAuth,
  write,
  validate({ params: eventParams, body: undoBody }),
  queue.undo,
);
