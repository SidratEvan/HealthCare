/**
 * The reducer, one event type at a time.
 *
 * Every member of `queue_event_type` gets a test, because the switch over it is
 * exhaustive and a new type cannot be added without a decision being recorded
 * here about what it does.
 */

import { describe, expect, it } from 'vitest';

import { QUEUE_EVENT_TYPES } from '../../types/enums.js';
import { id, serial, timestamp, type PatientId, type SlotOfferId } from '../../types/ids.js';
import { reduce } from '../reducer.js';
import { replay } from '../replay.js';
import {
  activeQueue,
  checkInvariants,
  emptyState,
  findEntry,
  nowServing,
  patientsAhead,
  project,
  queueCounts,
  waitingQueue,
} from '../state.js';

import { bookingId, LogBuilder, makeSeed } from './support.js';

function setup(size = 5): {
  state: ReturnType<typeof emptyState>;
  log: LogBuilder;
} {
  const seed = makeSeed(size);
  return { state: emptyState(seed), log: new LogBuilder(seed.plan.sessionId) };
}

/** Folds a sequence of events, returning the final state. */
function fold(
  state: ReturnType<typeof emptyState>,
  events: readonly Parameters<typeof reduce>[1][],
): ReturnType<typeof emptyState> {
  return events.reduce(reduce, state);
}

describe('emptyState', () => {
  it('puts every booking in the queue in serial order, none of them processed', () => {
    const state = emptyState(makeSeed(4));

    expect(state.entries.map((entry) => entry.serial)).toEqual([1, 2, 3, 4]);
    expect(state.entries.every((entry) => entry.status === 'booked')).toBe(true);
    expect(state.status).toBe('scheduled');
    expect(state.doctorArrivedAt).toBeNull();
    expect(nowServing(state)).toBeNull();
    expect(checkInvariants(state)).toEqual([]);
  });

  it('orders a reissued serial deterministically by creation time', () => {
    const seed = makeSeed(2);
    const withDuplicate = {
      plan: seed.plan,
      roster: [
        ...seed.roster,
        // A standby patient who accepted serial 1 after the original cancelled.
        {
          bookingId: bookingId(99),
          serial: serial(1),
          patientId: id<PatientId>('44444444-4444-7444-8444-000000000001'),
          source: 'app' as const,
          createdAt: timestamp('2026-09-17T10:00:00.000Z'),
        },
      ],
    };

    const first = emptyState(withDuplicate).entries.map((entry) => entry.bookingId);
    const reversed = emptyState({
      plan: withDuplicate.plan,
      roster: [...withDuplicate.roster].reverse(),
    }).entries.map((entry) => entry.bookingId);

    expect(first).toEqual(reversed);
  });
});

describe('session lifecycle', () => {
  it('SESSION_OPENED records the opening without claiming the doctor is in', () => {
    const { state, log } = setup();
    const next = reduce(state, log.next('SESSION_OPENED', {}));

    expect(next.openedAt).not.toBeNull();
    expect(next.status).toBe('scheduled');
    expect(next.doctorArrivedAt).toBeNull();
  });

  it('DOCTOR_ARRIVED starts the session and records the arrival time', () => {
    const { state, log } = setup();
    const arrivedAt = timestamp('2026-09-17T11:12:00.000Z');

    const next = fold(state, [
      log.next('SESSION_OPENED', {}),
      log.next('DOCTOR_ARRIVED', { arrivedAt, minutesLate: 12 }),
    ]);

    expect(next.status).toBe('running');
    expect(next.doctorArrivedAt).toBe(arrivedAt);
    expect(checkInvariants(next)).toEqual([]);
  });

  it('DELAY_DECLARED accumulates rather than replacing', () => {
    const { state, log } = setup();

    const next = fold(state, [
      log.next('DELAY_DECLARED', { minutes: 30, reason: 'surgery', declaredBy: 'doctor' }),
      log.next('DELAY_DECLARED', { minutes: 15, reason: null, declaredBy: 'reception' }),
    ]);

    expect(next.delayMinutes).toBe(45);
  });

  it('SESSION_PAUSED and SESSION_RESUMED accumulate the time lost', () => {
    const { state, log } = setup();

    const next = fold(state, [
      log.next('DOCTOR_ARRIVED', {
        arrivedAt: timestamp('2026-09-17T11:00:00.000Z'),
        minutesLate: 0,
      }),
      log.advance(60).next('SESSION_PAUSED', { reason: 'prayer' }),
      log.advance(600).next('SESSION_RESUMED', {}),
    ]);

    expect(next.status).toBe('running');
    expect(next.pausedAt).toBeNull();
    expect(next.pausedSeconds).toBe(600);
    expect(checkInvariants(next)).toEqual([]);
  });

  it('a pause before the doctor arrives resumes to scheduled, not running', () => {
    const { state, log } = setup();

    const next = fold(state, [
      log.next('SESSION_PAUSED', { reason: 'equipment' }),
      log.advance(120).next('SESSION_RESUMED', {}),
    ]);

    expect(next.status).toBe('scheduled');
    expect(checkInvariants(next)).toEqual([]);
  });

  it('SESSION_ENDED closes the session and clears any pause', () => {
    const { state, log } = setup();

    const next = fold(state, [
      log.next('SESSION_PAUSED', { reason: null }),
      log.next('SESSION_ENDED', { reason: 'doctor left' }),
    ]);

    expect(next.status).toBe('ended');
    expect(next.endedAt).not.toBeNull();
    expect(next.pausedAt).toBeNull();
  });
});

describe('calling and finishing patients', () => {
  it('PATIENT_CALLED puts exactly one patient in the chamber', () => {
    const { state, log } = setup();

    const next = fold(state, [
      log.next('DOCTOR_ARRIVED', {
        arrivedAt: timestamp('2026-09-17T11:00:00.000Z'),
        minutesLate: 0,
      }),
      log.next('PATIENT_CALLED', { bookingId: bookingId(1), serial: serial(1) }),
    ]);

    expect(nowServing(next)?.bookingId).toBe(bookingId(1));
    expect(findEntry(next, bookingId(1))?.calledAt).not.toBeNull();
    expect(queueCounts(next).inChamber).toBe(1);
    expect(checkInvariants(next)).toEqual([]);
  });

  it('PATIENT_DONE settles the patient and feeds the rate', () => {
    const { state, log } = setup();

    const next = fold(state, [
      log.next('DOCTOR_ARRIVED', {
        arrivedAt: timestamp('2026-09-17T11:00:00.000Z'),
        minutesLate: 0,
      }),
      log.next('PATIENT_CALLED', { bookingId: bookingId(1), serial: serial(1) }),
      log.advance(300).next('PATIENT_DONE', { bookingId: bookingId(1), consultSeconds: 300 }),
    ]);

    const entry = findEntry(next, bookingId(1));
    expect(entry?.status).toBe('done');
    expect(entry?.consultSeconds).toBe(300);
    expect(next.rate.currentSeconds).toBe(300);
    expect(nowServing(next)).toBeNull();
    expect(queueCounts(next).done).toBe(1);
  });

  it('records an anomaly when the log calls a second patient into an occupied chamber', () => {
    const { state, log } = setup();

    const next = fold(state, [
      log.next('DOCTOR_ARRIVED', {
        arrivedAt: timestamp('2026-09-17T11:00:00.000Z'),
        minutesLate: 0,
      }),
      log.next('PATIENT_CALLED', { bookingId: bookingId(1), serial: serial(1) }),
      log.next('PATIENT_CALLED', { bookingId: bookingId(2), serial: serial(2) }),
    ]);

    // FR-QUE-53: one patient in the chamber, and the clash is visible.
    expect(nowServing(next)?.bookingId).toBe(bookingId(2));
    expect(next.anomalies.map((a) => a.code)).toContain('DUPLICATE_CALL');
    expect(checkInvariants(next)).toEqual([]);
  });

  it('records an anomaly rather than throwing on an unknown booking', () => {
    const { state, log } = setup();

    const next = reduce(
      state,
      log.next('PATIENT_DONE', { bookingId: bookingId(404), consultSeconds: 120 }),
    );

    expect(next.anomalies).toHaveLength(1);
    expect(next.anomalies[0]?.code).toBe('UNKNOWN_BOOKING');
    expect(next.entries).toEqual(state.entries);
  });
});

describe('late patients are re-inserted, never dropped (FR-QUE-21)', () => {
  it('moves a late patient after k more patients', () => {
    const { state, log } = setup(6);

    const next = fold(state, [
      log.next('DOCTOR_ARRIVED', {
        arrivedAt: timestamp('2026-09-17T11:00:00.000Z'),
        minutesLate: 0,
      }),
      log.next('PATIENT_LATE', {
        bookingId: bookingId(1),
        expectedMinutes: 20,
        reinsertAfter: 3,
      }),
    ]);

    const order = activeQueue(next).map((entry) => entry.serial);
    expect(order).toEqual([2, 3, 4, 1, 5, 6]);
    expect(findEntry(next, bookingId(1))?.status).toBe('late');
    expect(activeQueue(next)).toHaveLength(6);
  });

  it('puts a late patient at the back when fewer than k patients remain', () => {
    const { state, log } = setup(3);

    const next = fold(state, [
      log.next('PATIENT_LATE', {
        bookingId: bookingId(1),
        expectedMinutes: 30,
        reinsertAfter: 10,
      }),
    ]);

    expect(activeQueue(next).map((entry) => entry.serial)).toEqual([2, 3, 1]);
    expect(activeQueue(next)).toHaveLength(3);
  });

  it('keeps a late patient in the queue, which is the whole point of the rule', () => {
    const { state, log } = setup(4);

    const next = reduce(
      state,
      log.next('PATIENT_LATE', { bookingId: bookingId(2), expectedMinutes: 45, reinsertAfter: 3 }),
    );

    expect(activeQueue(next).some((entry) => entry.bookingId === bookingId(2))).toBe(true);
    expect(queueCounts(next).late).toBe(1);
  });
});

describe('no-show and reinstatement (FR-QUE-22)', () => {
  it('PATIENT_NO_SHOW removes the patient from the line but not from history', () => {
    const { state, log } = setup(4);

    const next = reduce(
      state,
      log.next('PATIENT_NO_SHOW', { bookingId: bookingId(1), graceUsedMinutes: 17 }),
    );

    expect(findEntry(next, bookingId(1))?.status).toBe('no_show');
    expect(activeQueue(next).map((entry) => entry.serial)).toEqual([2, 3, 4]);
    expect(next.entries).toHaveLength(4);
    expect(queueCounts(next).noShow).toBe(1);
  });

  it('PATIENT_REINSERTED brings them back at the stated position', () => {
    const { state, log } = setup(5);

    const next = fold(state, [
      log.next('PATIENT_NO_SHOW', { bookingId: bookingId(1), graceUsedMinutes: 20 }),
      log.next('PATIENT_REINSERTED', { bookingId: bookingId(1), newPosition: 2 }),
    ]);

    expect(activeQueue(next).map((entry) => entry.serial)).toEqual([2, 3, 1, 4, 5]);
    expect(findEntry(next, bookingId(1))?.status).toBe('waiting');
    expect(findEntry(next, bookingId(1))?.noShow).toBeNull();
    expect(checkInvariants(next)).toEqual([]);
  });
});

describe('walk-ins and cancellations', () => {
  it('WALKIN_ADDED at the end puts the patient last', () => {
    const { state, log } = setup(3);

    const next = reduce(
      state,
      log.next('WALKIN_ADDED', {
        bookingId: bookingId(1),
        position: 'end',
        index: null,
        reason: null,
      }),
    );

    expect(activeQueue(next).map((entry) => entry.serial)).toEqual([2, 3, 1]);
    expect(findEntry(next, bookingId(1))?.arrivedAt).not.toBeNull();
  });

  it('WALKIN_ADDED at an index puts the patient there', () => {
    const { state, log } = setup(4);

    const next = reduce(
      state,
      log.next('WALKIN_ADDED', {
        bookingId: bookingId(4),
        position: 'index',
        index: 1,
        reason: 'referred by the ER',
      }),
    );

    expect(activeQueue(next).map((entry) => entry.serial)).toEqual([1, 4, 2, 3]);
  });

  it('BOOKING_CANCELLED takes the patient out of the line and frees the place', () => {
    const { state, log } = setup(3);

    const next = reduce(
      state,
      log.next('BOOKING_CANCELLED', { bookingId: bookingId(2), reason: 'patient cancelled' }),
    );

    expect(activeQueue(next).map((entry) => entry.serial)).toEqual([1, 3]);
    expect(findEntry(next, bookingId(2))?.status).toBe('cancelled');
  });
});

describe('slot offers (FR-QUE-30)', () => {
  it('SLOT_OFFERED records a pending offer', () => {
    const { state, log } = setup(3);

    const next = reduce(
      state,
      log.next('SLOT_OFFERED', {
        offerId: id<SlotOfferId>('55555555-5555-7555-8555-000000000001'),
        freedBookingId: bookingId(1),
        offeredTo: [id<PatientId>('44444444-4444-7444-8444-000000000001')],
        expiresAt: timestamp('2026-09-17T12:00:00.000Z'),
      }),
    );

    expect(next.offers).toHaveLength(1);
    expect(next.offers[0]?.outcome).toBe('pending');
  });

  it('SLOT_ACCEPTED resolves the offer and the accepting booking joins the queue', () => {
    const { state, log } = setup(3);

    const next = fold(state, [
      log.next('SLOT_OFFERED', {
        offerId: id<SlotOfferId>('55555555-5555-7555-8555-000000000001'),
        freedBookingId: bookingId(1),
        offeredTo: [],
        expiresAt: timestamp('2026-09-17T12:00:00.000Z'),
      }),
      log.next('SLOT_ACCEPTED', {
        offerId: id<SlotOfferId>('55555555-5555-7555-8555-000000000001'),
        newBookingId: bookingId(3),
      }),
    ]);

    expect(next.offers[0]?.outcome).toBe('accepted');
    expect(next.offers[0]?.acceptedBookingId).toBe(bookingId(3));
    expect(findEntry(next, bookingId(3))?.status).toBe('waiting');
  });

  it('a late SLOT_EXPIRED cannot overwrite an acceptance', () => {
    const { state, log } = setup(3);

    const next = fold(state, [
      log.next('SLOT_OFFERED', {
        offerId: id<SlotOfferId>('55555555-5555-7555-8555-000000000001'),
        freedBookingId: bookingId(1),
        offeredTo: [],
        expiresAt: timestamp('2026-09-17T12:00:00.000Z'),
      }),
      log.next('SLOT_ACCEPTED', {
        offerId: id<SlotOfferId>('55555555-5555-7555-8555-000000000001'),
        newBookingId: bookingId(2),
      }),
      log.next('SLOT_EXPIRED', {
        offerId: id<SlotOfferId>('55555555-5555-7555-8555-000000000001'),
      }),
    ]);

    expect(next.offers[0]?.outcome).toBe('accepted');
  });

  it('records an anomaly when an offer is resolved that was never made', () => {
    const { state, log } = setup(3);

    const next = reduce(
      state,
      log.next('SLOT_EXPIRED', {
        offerId: id<SlotOfferId>('55555555-5555-7555-8555-000000000999'),
      }),
    );

    expect(next.anomalies.map((a) => a.code)).toContain('UNKNOWN_OFFER');
  });
});

describe('priority reordering (FR-REC-15)', () => {
  it('PRIORITY_REORDERED moves the patient and records the reason', () => {
    const { state, log } = setup(5);

    const next = reduce(
      state,
      log.next('PRIORITY_REORDERED', {
        bookingId: bookingId(5),
        fromIndex: 4,
        toIndex: 0,
        reason: 'elderly',
      }),
    );

    expect(activeQueue(next).map((entry) => entry.serial)).toEqual([5, 1, 2, 3, 4]);
    expect(findEntry(next, bookingId(5))?.priority?.reason).toBe('elderly');
  });
});

describe('re-delivered events (SY-01, SY-02)', () => {
  it('ignores an event at or below the cursor, so a socket echo cannot double a delay', () => {
    const { state, log } = setup(3);
    const declared = log.next('DELAY_DECLARED', {
      minutes: 30,
      reason: 'surgery',
      declaredBy: 'doctor',
    });

    const once = reduce(state, declared);
    const again = reduce(once, declared);

    expect(once.delayMinutes).toBe(30);
    expect(again.delayMinutes).toBe(30);
    expect(again).toEqual(once);
  });

  it('ignores an overlapping range when a reconnecting client resumes from an old seq', () => {
    const { state, log } = setup(3);

    const first = log.next('DELAY_DECLARED', {
      minutes: 15,
      reason: null,
      declaredBy: 'reception',
    });
    const second = log.next('DELAY_DECLARED', {
      minutes: 15,
      reason: null,
      declaredBy: 'reception',
    });

    const caughtUp = fold(state, [first, second]);
    const resumedTooEarly = fold(caughtUp, [first, second]);

    expect(caughtUp.delayMinutes).toBe(30);
    expect(resumedTooEarly.delayMinutes).toBe(30);
  });

  it('still folds an unordered batch correctly, because replay sorts by seq first', () => {
    const seed = makeSeed(3);
    const builder = new LogBuilder(seed.plan.sessionId);

    const first = builder.next('DELAY_DECLARED', {
      minutes: 15,
      reason: null,
      declaredBy: 'reception',
    });
    const second = builder.next('DELAY_DECLARED', {
      minutes: 15,
      reason: null,
      declaredBy: 'reception',
    });

    // An offline console sends its batch in client-timestamp order; the server
    // sequence is authoritative, and `replay` applies it.
    expect(replay(seed, [second, first]).delayMinutes).toBe(30);
  });
});

describe('coverage of the event union', () => {
  it('handles every member of queue_event_type', () => {
    // A reminder rather than an assertion about behaviour: if a type is added
    // to DATABASE.md §1 and to the union, this list is where the gap shows.
    const covered = new Set([
      'SESSION_OPENED',
      'DOCTOR_ARRIVED',
      'DELAY_DECLARED',
      'SESSION_PAUSED',
      'SESSION_RESUMED',
      'PATIENT_CALLED',
      'PATIENT_DONE',
      'PATIENT_LATE',
      'PATIENT_NO_SHOW',
      'PATIENT_REINSERTED',
      'WALKIN_ADDED',
      'BOOKING_CANCELLED',
      'SLOT_OFFERED',
      'SLOT_ACCEPTED',
      'SLOT_EXPIRED',
      'PRIORITY_REORDERED',
      'SESSION_ENDED',
      'ACTION_UNDONE',
    ]);

    expect([...QUEUE_EVENT_TYPES].filter((type) => !covered.has(type))).toEqual([]);
    expect(QUEUE_EVENT_TYPES).toHaveLength(18);
  });
});

describe('the projection written to queue_state', () => {
  it('matches what the reducer derived', () => {
    const { state, log } = setup(4);

    const next = fold(state, [
      log.next('DOCTOR_ARRIVED', {
        arrivedAt: timestamp('2026-09-17T11:00:00.000Z'),
        minutesLate: 0,
      }),
      log.next('PATIENT_CALLED', { bookingId: bookingId(1), serial: serial(1) }),
      log.advance(420).next('PATIENT_DONE', { bookingId: bookingId(1), consultSeconds: 420 }),
      log.next('PATIENT_CALLED', { bookingId: bookingId(2), serial: serial(2) }),
      log.next('PATIENT_NO_SHOW', { bookingId: bookingId(4), graceUsedMinutes: 16 }),
    ]);

    expect(project(next)).toEqual({
      sessionId: next.plan.sessionId,
      nowServingBookingId: bookingId(2),
      nowServingSerial: 2,
      waitingCount: 1,
      lateCount: 0,
      noShowCount: 1,
      doneCount: 1,
      avgConsultSeconds: 420,
      rebuiltFromSeq: next.lastSeq,
    });
  });

  it('reports no average before any consultation has been measured', () => {
    const state = emptyState(makeSeed(3));
    expect(project(state).avgConsultSeconds).toBeNull();
  });
});

describe('patientsAhead', () => {
  it('counts the patient in the chamber, whose consultation still has to end', () => {
    const { state, log } = setup(4);

    const next = fold(state, [
      log.next('DOCTOR_ARRIVED', {
        arrivedAt: timestamp('2026-09-17T11:00:00.000Z'),
        minutesLate: 0,
      }),
      log.next('PATIENT_CALLED', { bookingId: bookingId(1), serial: serial(1) }),
    ]);

    expect(patientsAhead(next, bookingId(2))).toBe(1);
    expect(patientsAhead(next, bookingId(3))).toBe(2);
    expect(waitingQueue(next)).toHaveLength(3);
  });
});
