/**
 * A booking's ticket: what stands for it in the queue a patient's phone is
 * sent (plan I2c; `shared/domain` `queue/patientView`; `BACKEND.md` §6).
 *
 * The patients' copy of a chamber names no booking, so each row carries a
 * ticket instead. A ticket is an HMAC of the chamber and the booking under a
 * key derived from `GUEST_LINK_SECRET`: the same booking has the same ticket
 * in every broadcast, so a phone told its own once finds its row in each; it
 * cannot be turned back into the booking, so a phone holding every ticket in
 * the chamber holds nothing it can ask the server about; and it is a
 * different value in another chamber.
 *
 * Shaped as a UUID only so that nothing on the phone that checks the form of
 * an id refuses one. It is not an id and no table holds it.
 */

import { createHmac } from 'node:crypto';

import type { BookingId } from '@platform/domain';

import { env } from '../env.js';

/** Kept apart from the links' own signatures by its label. */
const LABEL = 'serial-ticket';

export function ticketFor(sessionId: string, bookingId: string): BookingId {
  const hex = createHmac('sha256', env.GUEST_LINK_SECRET)
    .update(`${LABEL}\0${sessionId}\0${bookingId}`)
    .digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-') as BookingId;
}

/** The ticket function for one chamber, as `patientViewOf` takes it. */
export function ticketsIn(sessionId: string): (bookingId: BookingId) => BookingId {
  return (bookingId) => ticketFor(sessionId, bookingId);
}
