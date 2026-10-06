/**
 * Whether a booking is still current (`PRD.md` `FR-PAT-39`, `FR-QUE-06`;
 * founder's decision, 2026-10-05).
 *
 * "A serial is current until it is settled, whatever the date." A booking is
 * current while it is unresolved in a session that has not ended. It is past
 * when the patient has been seen or has cancelled, or when the session has
 * actually ended.
 *
 * There is no date in this function, and that is the rule. Somebody waiting
 * at 23:59 is still waiting at 00:01; a chamber paused across midnight is
 * still their chamber; and the next day's scheduled chamber for the same
 * doctor is another session, which changes nothing about this one.
 *
 * Marked absent is not settled. While the chamber is open reception can bring
 * the patient back (`FR-QUE-20`), so their serial is still theirs to watch;
 * it becomes past when the session ends, like everybody else's.
 */

import type { BookingStatus, SessionStatus } from '../types/enums.js';

export type BookingStanding = 'current' | 'past';

/** The session is over: nothing more will happen in it. */
const SESSION_OVER: readonly SessionStatus[] = ['ended', 'cancelled'];

/** The booking is settled: the patient was seen, or gave the serial up. */
const BOOKING_SETTLED: readonly BookingStatus[] = ['done', 'cancelled', 'rescheduled'];

export function bookingStanding(session: SessionStatus, booking: BookingStatus): BookingStanding {
  if (SESSION_OVER.includes(session)) return 'past';
  if (BOOKING_SETTLED.includes(booking)) return 'past';
  return 'current';
}
