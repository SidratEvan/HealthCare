/**
 * What a patient's phone is sent of a chamber (plan I2c; handover 30;
 * `FR-NET-02`, `FR-SEC-11`; `BACKEND.md` §6).
 *
 * A phone following its serial needs the whole queue: how many are ahead,
 * who is in the chamber, how fast it is moving, its own place and estimate.
 * It does not need to know who anybody else is. It used to be sent the queue
 * exactly as reception holds it, so every waiting patient's phone held every
 * other booking's id and every other patient's record id, and could have
 * asked the server about each.
 *
 * So the patients' copy is the same queue with nothing in it that names a
 * person or a booking:
 *
 * - each booking's id is replaced by a **ticket**, a value the server derives
 *   from the booking with a key only it holds, which means nothing anywhere
 *   but in this chamber's broadcast. A phone is told its own booking's ticket
 *   with its booking (`GET /bookings/:id`) and finds its row by it;
 * - a patient's id is the nil id, and an offer is to nobody in particular;
 * - what reception typed — a cancellation's reason, a priority's — is not
 *   sent: "elderly, breathing difficulty" is somebody's health;
 * - the log's own bookkeeping (anomalies, undone event ids) is not sent.
 *
 * The shape is the same as the staff's, so everything that reads a queue on
 * the phone (`aheadOf`, the estimates) reads this one unchanged.
 *
 * Pure: the ticket is the caller's to make, because it needs a key.
 */

import type { Eta } from './eta.js';
import type { QueueState } from './state.js';
import type { BookingId, PatientId } from '../types/ids.js';

/** Who a patient row is about, in the patients' copy: nobody. */
export const NO_PATIENT = '00000000-0000-0000-0000-000000000000' as PatientId;

export interface PatientQueueView {
  readonly state: QueueState;
  readonly etas: readonly Eta[];
}

export function patientViewOf(
  state: QueueState,
  etas: readonly Eta[],
  ticketOf: (bookingId: BookingId) => BookingId,
): PatientQueueView {
  return {
    state: {
      ...state,
      entries: state.entries.map((entry) => ({
        ...entry,
        bookingId: ticketOf(entry.bookingId),
        patientId: NO_PATIENT,
        cancelled: entry.cancelled === null ? null : { ...entry.cancelled, reason: null },
        priority: entry.priority === null ? null : { ...entry.priority, reason: '' },
      })),
      offers: state.offers.map((offer) => ({
        ...offer,
        freedBookingId: ticketOf(offer.freedBookingId),
        offeredTo: [],
        acceptedBookingId:
          offer.acceptedBookingId === null ? null : ticketOf(offer.acceptedBookingId),
      })),
      undoneEventIds: [],
      anomalies: [],
    },
    etas: etas.map((eta) => ({ ...eta, bookingId: ticketOf(eta.bookingId) })),
  };
}
