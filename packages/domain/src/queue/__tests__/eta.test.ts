/**
 * ETA maths (FR-QUE-11..15).
 *
 * The number a waiting family reads, so the tests are written from their side:
 * what does the screen say, and is it the kind of wrong that costs an hour in
 * a corridor or the kind that costs a missed turn.
 */

import { describe, expect, it } from 'vitest';

import { serial, timestamp, type BookingId, type Timestamp } from '../../types/ids.js';
import { differenceInMinutes } from '../../util/time.js';
import {
  bandMinutes,
  computeEtas,
  etaFor,
  projectedEnd,
  shouldLeaveNow,
  twoAwayBookings,
  MAX_BAND_MINUTES,
  MIN_BAND_MINUTES,
} from '../eta.js';
import { reduce } from '../reducer.js';
import { emptyState, type QueueState } from '../state.js';

import { bookingId, LogBuilder, makeSeed } from './support.js';

const PLANNED_START = timestamp('2026-09-17T11:00:00.000Z');

/** A session with `size` patients and an eight-minute default consultation. */
function session(size = 6): { state: QueueState; log: LogBuilder } {
  const seed = makeSeed(size, { defaultConsultSeconds: 480 });
  return { state: emptyState(seed), log: new LogBuilder(seed.plan.sessionId) };
}

function fold(state: QueueState, events: readonly Parameters<typeof reduce>[1][]): QueueState {
  return events.reduce(reduce, state);
}

function arrive(log: LogBuilder, at: Timestamp): Parameters<typeof reduce>[1] {
  return log.next('DOCTOR_ARRIVED', { arrivedAt: at, minutesLate: 0 });
}

describe('before the doctor arrives', () => {
  it('counts from the planned start, not from now', () => {
    const { state } = session(4);
    const now = timestamp('2026-09-17T10:30:00.000Z');

    const etas = computeEtas(state, now);

    expect(etas).toHaveLength(4);
    expect(etas[0]?.etaAt).toBe(PLANNED_START);
    // Eight minutes per patient.
    expect(differenceInMinutes(etas[1]?.etaAt ?? now, PLANNED_START)).toBe(8);
  });

  it('will not claim the planned start once it has passed', () => {
    const { state } = session(3);
    const now = timestamp('2026-09-17T11:40:00.000Z');

    const etas = computeEtas(state, now);

    // A session due at five that has not begun at half past does not get to
    // keep promising five.
    expect(etas[0]?.etaAt).toBe(timestamp('2026-09-17T11:40:00.000Z'));
  });

  it('says it does not know, rather than offering false precision', () => {
    const { state } = session(3);
    const etas = computeEtas(state, timestamp('2026-09-17T10:30:00.000Z'));

    expect(etas[0]?.confidence).toBe('unknown');
    expect(etas[0]?.bandMinutes).toBe(MAX_BAND_MINUTES);
  });

  it('pushes every estimate back by a declared delay (FR-PAT-34)', () => {
    const { state, log } = session(3);
    const now = timestamp('2026-09-17T10:30:00.000Z');

    const delayed = reduce(
      state,
      log.next('DELAY_DECLARED', { minutes: 30, reason: 'surgery', declaredBy: 'doctor' }),
    );

    const before = computeEtas(state, now)[0]?.etaAt ?? now;
    const after = computeEtas(delayed, now)[0]?.etaAt ?? now;

    expect(differenceInMinutes(after, before)).toBe(30);
  });
});

describe('once the chamber is running', () => {
  it('multiplies the measured rate by the patients ahead (FR-QUE-11)', () => {
    const { state, log } = session(5);
    const now = timestamp('2026-09-17T11:20:00.000Z');

    const running = fold(state, [
      arrive(log, PLANNED_START),
      log.next('PATIENT_CALLED', { bookingId: bookingId(1), serial: serial(1) }),
      log.advance(300).next('PATIENT_DONE', { bookingId: bookingId(1), consultSeconds: 300 }),
    ]);

    // One measurement of five minutes replaces the eight-minute default.
    expect(running.rate.currentSeconds).toBe(300);

    const etas = computeEtas(running, now);
    expect(etas[0]?.etaAt).toBe(now);
    expect(differenceInMinutes(etas[1]?.etaAt ?? now, now)).toBe(5);
    expect(differenceInMinutes(etas[2]?.etaAt ?? now, now)).toBe(10);
  });

  it('credits time already spent in the chamber, so the next patient is not promised a full slot', () => {
    const { state, log } = session(4);
    const calledAt = timestamp('2026-09-17T11:10:00.000Z');
    const now = timestamp('2026-09-17T11:14:00.000Z');

    const running = fold(state, [
      arrive(log, PLANNED_START),
      log.advance(600).next('PATIENT_CALLED', { bookingId: bookingId(1), serial: serial(1) }),
    ]);

    expect(running.entries[0]?.calledAt).toBe(calledAt);

    const etas = computeEtas(running, now);
    // Four of the eight minutes are already spent, so the next patient is
    // about four minutes away rather than eight.
    expect(differenceInMinutes(etas[0]?.etaAt ?? now, now)).toBe(4);
    expect(etas[0]?.patientsAhead).toBe(1);
  });

  it('never promises a time in the past for the patient in the chamber', () => {
    const { state, log } = session(3);
    const now = timestamp('2026-09-17T12:30:00.000Z');

    const running = fold(state, [
      arrive(log, PLANNED_START),
      log.advance(60).next('PATIENT_CALLED', { bookingId: bookingId(1), serial: serial(1) }),
    ]);

    for (const eta of computeEtas(running, now)) {
      expect(eta.etaAt >= now).toBe(true);
    }
  });

  it('reports measured confidence only once a consultation has been timed', () => {
    const { state, log } = session(4);
    const now = timestamp('2026-09-17T11:05:00.000Z');

    const arrived = reduce(state, arrive(log, PLANNED_START));
    expect(computeEtas(arrived, now)[0]?.confidence).toBe('estimated');

    const measured = fold(arrived, [
      log.next('PATIENT_CALLED', { bookingId: bookingId(1), serial: serial(1) }),
      log.advance(420).next('PATIENT_DONE', { bookingId: bookingId(1), consultSeconds: 420 }),
    ]);
    expect(computeEtas(measured, now)[0]?.confidence).toBe('measured');
  });
});

describe('a paused session (FR-REC-05)', () => {
  it('stops claiming to know, because nothing can know when a prayer break ends', () => {
    const { state, log } = session(4);
    const now = timestamp('2026-09-17T11:30:00.000Z');

    const paused = fold(state, [
      arrive(log, PLANNED_START),
      log.advance(600).next('SESSION_PAUSED', { reason: 'prayer' }),
    ]);

    const etas = computeEtas(paused, now);
    expect(etas[0]?.confidence).toBe('unknown');
    expect(etas[0]?.bandMinutes).toBe(MAX_BAND_MINUTES);
    expect(projectedEnd(paused, now)).toBeNull();
  });
});

describe('the confidence band (FR-QUE-13)', () => {
  it('widens with the number of patients ahead', () => {
    const spread = 180;
    const near = bandMinutes(1, spread, 'measured');
    const far = bandMinutes(16, spread, 'measured');

    expect(far).toBeGreaterThan(near);
  });

  it('grows more slowly than the queue, because errors partly cancel', () => {
    const spread = 180;
    const one = bandMinutes(1, spread, 'measured');
    const sixteen = bandMinutes(16, spread, 'measured');

    // Sixteen times the patients is four times the uncertainty, not sixteen.
    expect(sixteen).toBeLessThan(one * 16);
  });

  it('never claims a band narrower than five minutes', () => {
    expect(bandMinutes(0, 1, 'measured')).toBe(MIN_BAND_MINUTES);
  });

  it('never shows a band wider than forty-five minutes', () => {
    expect(bandMinutes(500, 3600, 'measured')).toBe(MAX_BAND_MINUTES);
  });

  it('is at its widest when the session is not running', () => {
    expect(bandMinutes(1, 60, 'unknown')).toBe(MAX_BAND_MINUTES);
  });

  it('is tighter for a chamber running to a rhythm than one that is not', () => {
    const steady = bandMinutes(5, 60, 'measured');
    const erratic = bandMinutes(5, 600, 'measured');

    expect(steady).toBeLessThan(erratic);
  });
});

describe('an ETA that moves earlier (FR-QUE-15)', () => {
  it('is flagged, so the patient can be told before their turn arrives early', () => {
    const { state, log } = session(5);
    const now = timestamp('2026-09-17T11:00:00.000Z');

    // The queue shortens: two patients ahead cancel.
    const shortened = fold(state, [
      arrive(log, PLANNED_START),
      log.next('BOOKING_CANCELLED', { bookingId: bookingId(1), reason: 'cancelled' }),
      log.next('BOOKING_CANCELLED', { bookingId: bookingId(2), reason: 'cancelled' }),
    ]);

    const previous = new Map<BookingId, Timestamp>([
      [bookingId(3), timestamp('2026-09-17T11:30:00.000Z')],
    ]);

    const eta = etaFor(shortened, bookingId(3), now, { previous });

    expect(eta?.movedEarlier).toBe(true);
  });

  it('is not flagged when the estimate slips later, which needs no warning', () => {
    const { state, log } = session(4);
    const now = timestamp('2026-09-17T11:00:00.000Z');

    const delayed = reduce(
      state,
      log.next('DELAY_DECLARED', { minutes: 30, reason: null, declaredBy: 'reception' }),
    );

    const previous = new Map<BookingId, Timestamp>([
      [bookingId(1), timestamp('2026-09-17T11:00:00.000Z')],
    ]);

    expect(etaFor(delayed, bookingId(1), now, { previous })?.movedEarlier).toBe(false);
  });

  it('is not flagged when nothing was previously communicated', () => {
    const { state } = session(3);
    const eta = etaFor(state, bookingId(1), timestamp('2026-09-17T10:00:00.000Z'));

    expect(eta?.movedEarlier).toBe(false);
  });
});

describe('the leave-home alert (FR-PAT-32)', () => {
  it('fires when the remaining wait has shrunk to travel time plus buffer', () => {
    // Twelve patients at eight minutes each, so the back of the queue is
    // comfortably beyond a 25-minute journey and the front is not.
    const { state, log } = session(12);
    const now = timestamp('2026-09-17T11:00:00.000Z');

    const running = fold(state, [
      arrive(log, PLANNED_START),
      log.next('PATIENT_CALLED', { bookingId: bookingId(1), serial: serial(1) }),
      log.advance(480).next('PATIENT_DONE', { bookingId: bookingId(1), consultSeconds: 480 }),
    ]);

    const nextUp = etaFor(running, bookingId(2), now);
    const farOff = etaFor(running, bookingId(12), now);

    expect(nextUp).not.toBeNull();
    expect(farOff).not.toBeNull();
    if (nextUp === null || farOff === null) return;

    expect(shouldLeaveNow(nextUp, now, 25)).toBe(true);
    expect(shouldLeaveNow(farOff, now, 25)).toBe(false);
  });

  it('does not fire when the session has not started, because the trigger would be a guess', () => {
    const { state } = session(4);
    const now = timestamp('2026-09-17T10:00:00.000Z');
    const eta = etaFor(state, bookingId(1), now);

    expect(eta).not.toBeNull();
    if (eta === null) return;
    expect(shouldLeaveNow(eta, now, 600)).toBe(false);
  });
});

describe('the two-away notice (FR-NOT-03)', () => {
  it('names the patient two places from the chamber', () => {
    const { state, log } = session(6);

    const running = fold(state, [
      arrive(log, PLANNED_START),
      log.next('PATIENT_CALLED', { bookingId: bookingId(1), serial: serial(1) }),
    ]);

    // Serial 1 is in the chamber, so serial 2 is next and serial 3 is two away.
    expect(twoAwayBookings(running)).toEqual([bookingId(3)]);
  });

  it('names nobody when the queue is too short for the notice to mean anything', () => {
    const { state, log } = session(2);

    const running = fold(state, [
      arrive(log, PLANNED_START),
      log.next('PATIENT_CALLED', { bookingId: bookingId(1), serial: serial(1) }),
    ]);

    expect(twoAwayBookings(running)).toEqual([]);
  });
});

describe('projectedEnd', () => {
  it('estimates when the session will finish', () => {
    const { state, log } = session(5);
    const now = timestamp('2026-09-17T11:00:00.000Z');

    const running = fold(state, [
      arrive(log, PLANNED_START),
      log.next('PATIENT_CALLED', { bookingId: bookingId(1), serial: serial(1) }),
      log.advance(600).next('PATIENT_DONE', { bookingId: bookingId(1), consultSeconds: 600 }),
    ]);

    // Four left at ten minutes each.
    expect(differenceInMinutes(projectedEnd(running, now) ?? now, now)).toBe(40);
  });

  it('is null once nobody is left to see', () => {
    const { state, log } = session(1);
    const now = timestamp('2026-09-17T11:30:00.000Z');

    const finished = fold(state, [
      arrive(log, PLANNED_START),
      log.next('PATIENT_CALLED', { bookingId: bookingId(1), serial: serial(1) }),
      log.advance(300).next('PATIENT_DONE', { bookingId: bookingId(1), consultSeconds: 300 }),
    ]);

    expect(projectedEnd(finished, now)).toBeNull();
  });
});

describe('performance (NFR-03, FR-QUE-14)', () => {
  it('recalculates a hundred-patient session well inside 500 ms', () => {
    const seed = makeSeed(100, { defaultConsultSeconds: 480 });
    const log = new LogBuilder(seed.plan.sessionId);
    const now = timestamp('2026-09-17T11:30:00.000Z');

    const running = fold(emptyState(seed), [
      arrive(log, PLANNED_START),
      log.next('PATIENT_CALLED', { bookingId: bookingId(1), serial: serial(1) }),
      log.advance(420).next('PATIENT_DONE', { bookingId: bookingId(1), consultSeconds: 420 }),
    ]);

    const startedAt = Date.now();
    const etas = computeEtas(running, now);
    const elapsedMs = Date.now() - startedAt;

    expect(etas).toHaveLength(99);
    expect(elapsedMs).toBeLessThan(500);
  });
});

describe('settled patients get no estimate', () => {
  it('leaves out the done, the absent and the cancelled', () => {
    const { state, log } = session(5);
    const now = timestamp('2026-09-17T11:20:00.000Z');

    const later = fold(state, [
      arrive(log, PLANNED_START),
      log.next('PATIENT_CALLED', { bookingId: bookingId(1), serial: serial(1) }),
      log.advance(300).next('PATIENT_DONE', { bookingId: bookingId(1), consultSeconds: 300 }),
      log.next('PATIENT_NO_SHOW', { bookingId: bookingId(2), graceUsedMinutes: 16 }),
      log.next('BOOKING_CANCELLED', { bookingId: bookingId(3), reason: 'cancelled' }),
    ]);

    expect(computeEtas(later, now).map((eta) => eta.serial)).toEqual([4, 5]);
  });

  it('still gives a late patient an estimate, at their new place in the queue', () => {
    const { state, log } = session(5);
    const now = timestamp('2026-09-17T11:00:00.000Z');

    const late = fold(state, [
      arrive(log, PLANNED_START),
      log.next('PATIENT_LATE', {
        bookingId: bookingId(1),
        expectedMinutes: 20,
        reinsertAfter: 3,
      }),
    ]);

    const eta = etaFor(late, bookingId(1), now);
    expect(eta).not.toBeNull();
    expect(eta?.patientsAhead).toBe(3);
  });
});
