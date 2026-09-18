/**
 * The guards (FR-QUE-20..22, FR-REC-14, FR-REC-15).
 *
 * Each of these protects a patient rather than the schema, so the tests are
 * written around the situation being prevented: the person who stepped out to
 * find a toilet, the one stuck in traffic, the one moved up the queue without
 * a recorded reason.
 */

import { describe, expect, it } from 'vitest';

import { serial, timestamp } from '../../types/ids.js';
import { reduce } from '../reducer.js';
import {
  canAddWalkin,
  canCallNext,
  canDeclareDelay,
  canDeclareDoctorArrived,
  canDeclareLate,
  canMarkDone,
  canMarkNoShow,
  canPause,
  canReinstate,
  canReorder,
  canResume,
  graceRemaining,
  graceWindowMinutes,
  hasCapacity,
  nextToCall,
  DEFAULT_QUEUE_SETTINGS,
  MAX_DELAY_MINUTES,
} from '../rules.js';
import { emptyState, type QueueState } from '../state.js';

import { bookingId, LogBuilder, makeSeed } from './support.js';

const PLANNED_START = timestamp('2026-09-17T11:00:00.000Z');

function session(size = 5): { state: QueueState; log: LogBuilder } {
  const seed = makeSeed(size);
  return { state: emptyState(seed), log: new LogBuilder(seed.plan.sessionId) };
}

function fold(state: QueueState, events: readonly Parameters<typeof reduce>[1][]): QueueState {
  return events.reduce(reduce, state);
}

/** A running session with the doctor in and nobody in the chamber. */
function running(size = 5): { state: QueueState; log: LogBuilder } {
  const { state, log } = session(size);
  return {
    state: reduce(state, log.next('DOCTOR_ARRIVED', { arrivedAt: PLANNED_START, minutesLate: 0 })),
    log,
  };
}

describe('the documented defaults', () => {
  it('match FR-QUE-20, FR-QUE-21 and FR-OFF-04', () => {
    expect(DEFAULT_QUEUE_SETTINGS).toEqual({
      noShowGracePatients: 2,
      noShowGraceMinutes: 15,
      lateReinsertAfter: 3,
      staleThresholdMinutes: 10,
    });
  });
});

describe('calling the next patient', () => {
  it('refuses before the doctor has arrived, and says why', () => {
    const { state } = session();
    const result = canCallNext(state);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('SESSION_NOT_RUNNING');
    expect(result.detail).toContain('arrived');
  });

  it('allows the call once the doctor is in', () => {
    const { state } = running();
    expect(canCallNext(state).ok).toBe(true);
    expect(nextToCall(state)?.serial).toBe(1);
  });

  it('refuses while a patient is still in the chamber, naming the serial', () => {
    const { state, log } = running();
    const occupied = reduce(
      state,
      log.next('PATIENT_CALLED', { bookingId: bookingId(1), serial: serial(1) }),
    );

    const result = canCallNext(occupied);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The console's answer to this is to relabel the button and do both
    // actions (APP_FLOW.md B1.3), so the code has to be distinguishable.
    expect(result.code).toBe('PATIENT_IN_CHAMBER');
    expect(result.detail).toContain('1');
  });

  it('refuses while the session is paused', () => {
    const { state, log } = running();
    const paused = reduce(state, log.next('SESSION_PAUSED', { reason: 'prayer' }));

    const result = canCallNext(paused);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('SESSION_NOT_RUNNING');
  });

  it('refuses when nobody is waiting', () => {
    const { state, log } = running(1);
    const finished = fold(state, [
      log.next('PATIENT_CALLED', { bookingId: bookingId(1), serial: serial(1) }),
      log.advance(300).next('PATIENT_DONE', { bookingId: bookingId(1), consultSeconds: 300 }),
    ]);

    const result = canCallNext(finished);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('QUEUE_EMPTY');
  });

  it('refuses after the session has ended', () => {
    const { state, log } = running();
    const ended = reduce(state, log.next('SESSION_ENDED', { reason: null }));

    const result = canCallNext(ended);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('SESSION_ENDED');
  });
});

describe('marking a patient done', () => {
  it('allows it for the patient in the chamber', () => {
    const { state, log } = running();
    const occupied = reduce(
      state,
      log.next('PATIENT_CALLED', { bookingId: bookingId(1), serial: serial(1) }),
    );

    expect(canMarkDone(occupied, bookingId(1)).ok).toBe(true);
  });

  it('refuses for a patient who was never called', () => {
    const { state } = running();
    const result = canMarkDone(state, bookingId(2));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('BOOKING_SETTLED');
  });

  it('refuses for a booking in another session', () => {
    const { state } = running();
    const result = canMarkDone(state, bookingId(999));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNKNOWN_BOOKING');
  });
});

describe('the no-show grace period (FR-QUE-20)', () => {
  /** A session where one patient has been seen, so the next is at the front. */
  function atFront(consultSeconds: number): QueueState {
    const { state, log } = running();
    return fold(state, [
      log.next('PATIENT_CALLED', { bookingId: bookingId(1), serial: serial(1) }),
      log.advance(consultSeconds).next('PATIENT_DONE', { bookingId: bookingId(1), consultSeconds }),
    ]);
  }

  it('refuses the moment a turn arrives', () => {
    const state = atFront(300);
    const result = canMarkNoShow(
      state,
      bookingId(2),
      DEFAULT_QUEUE_SETTINGS,
      timestamp('2026-09-17T11:05:00.000Z'),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NO_SHOW_BEFORE_GRACE');
  });

  it('gives a fast chamber the fifteen-minute floor, not two quick slots', () => {
    // Five minutes a patient: two patients' time is ten minutes, so the floor
    // governs and the patient still gets fifteen.
    const state = atFront(300);
    expect(graceWindowMinutes(state, DEFAULT_QUEUE_SETTINGS)).toBe(15);

    // Turn arrived at 11:05.
    const tenMinutesLater = timestamp('2026-09-17T11:15:00.000Z');
    const sixteenMinutesLater = timestamp('2026-09-17T11:21:00.000Z');

    expect(canMarkNoShow(state, bookingId(2), DEFAULT_QUEUE_SETTINGS, tenMinutesLater).ok).toBe(
      false,
    );
    expect(canMarkNoShow(state, bookingId(2), DEFAULT_QUEUE_SETTINGS, sixteenMinutesLater).ok).toBe(
      true,
    );
  });

  it('gives a slow chamber the longer window, because two slots really are longer', () => {
    // Twelve minutes a patient: two patients' time is twenty-four minutes.
    const state = atFront(720);
    expect(graceWindowMinutes(state, DEFAULT_QUEUE_SETTINGS)).toBe(24);

    // Turn arrived at 11:12.
    const twentyMinutesLater = timestamp('2026-09-17T11:32:00.000Z');
    const twentyFiveMinutesLater = timestamp('2026-09-17T11:37:00.000Z');

    expect(canMarkNoShow(state, bookingId(2), DEFAULT_QUEUE_SETTINGS, twentyMinutesLater).ok).toBe(
      false,
    );
    expect(
      canMarkNoShow(state, bookingId(2), DEFAULT_QUEUE_SETTINGS, twentyFiveMinutesLater).ok,
    ).toBe(true);
  });

  it('runs the clock from the turn, never from the planned start', () => {
    const state = atFront(300);
    const grace = graceRemaining(
      state,
      bookingId(2),
      DEFAULT_QUEUE_SETTINGS,
      timestamp('2026-09-17T11:09:00.000Z'),
    );

    // The previous consultation ended at 11:05, which is when this patient
    // reached the front — not 11:00 when the session was due to start.
    expect(grace?.turnReachedAt).toBe(timestamp('2026-09-17T11:05:00.000Z'));
    expect(grace?.minutesRemaining).toBe(11);
    expect(grace?.windowMinutes).toBe(15);
  });

  it('never deadlocks the counter, whatever the queue does', () => {
    // The interpretation that counts calls instead of time would hang here:
    // the absent patient is at the front, so no further call can happen, so a
    // call-counting threshold would never be reached and the receptionist
    // could never move on (PRD.md §3.4).
    const state = atFront(300);
    const muchLater = timestamp('2026-09-17T13:00:00.000Z');

    expect(canMarkNoShow(state, bookingId(2), DEFAULT_QUEUE_SETTINGS, muchLater).ok).toBe(true);
  });

  it('refuses for a patient whose turn has not come round', () => {
    const { state } = running();
    const result = canMarkNoShow(
      state,
      bookingId(5),
      DEFAULT_QUEUE_SETTINGS,
      timestamp('2026-09-17T13:00:00.000Z'),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_A_NO_SHOW');
  });

  it('honours a hospital that has configured a shorter grace', () => {
    const state = atFront(300);
    const lenient = { ...DEFAULT_QUEUE_SETTINGS, noShowGracePatients: 1, noShowGraceMinutes: 2 };

    expect(graceWindowMinutes(state, lenient)).toBe(5);
    expect(
      canMarkNoShow(state, bookingId(2), lenient, timestamp('2026-09-17T11:11:00.000Z')).ok,
    ).toBe(true);
  });

  it('refuses to mark the same patient absent twice', () => {
    const { state, log } = running();
    const absent = reduce(
      state,
      log.next('PATIENT_NO_SHOW', { bookingId: bookingId(1), graceUsedMinutes: 20 }),
    );

    const result = canMarkNoShow(
      absent,
      bookingId(1),
      DEFAULT_QUEUE_SETTINGS,
      timestamp('2026-09-17T12:00:00.000Z'),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('BOOKING_SETTLED');
  });
});

describe('reinstating a patient (FR-QUE-22)', () => {
  it('allows a no-show back into the queue', () => {
    const { state, log } = running();
    const absent = reduce(
      state,
      log.next('PATIENT_NO_SHOW', { bookingId: bookingId(1), graceUsedMinutes: 20 }),
    );

    expect(canReinstate(absent, bookingId(1)).ok).toBe(true);
  });

  it('refuses for a patient who was already seen', () => {
    const { state, log } = running();
    const seen = fold(state, [
      log.next('PATIENT_CALLED', { bookingId: bookingId(1), serial: serial(1) }),
      log.advance(300).next('PATIENT_DONE', { bookingId: bookingId(1), consultSeconds: 300 }),
    ]);

    const result = canReinstate(seen, bookingId(1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_A_NO_SHOW');
  });
});

describe('a patient declaring lateness (FR-PAT-33)', () => {
  it('is allowed while they are still waiting', () => {
    const { state } = running();
    expect(canDeclareLate(state, bookingId(3)).ok).toBe(true);
  });

  it('is refused once they are in the chamber', () => {
    const { state, log } = running();
    const called = reduce(
      state,
      log.next('PATIENT_CALLED', { bookingId: bookingId(1), serial: serial(1) }),
    );

    const result = canDeclareLate(called, bookingId(1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('PATIENT_IN_CHAMBER');
  });

  it('is refused after the session has ended', () => {
    const { state, log } = running();
    const ended = reduce(state, log.next('SESSION_ENDED', { reason: null }));

    const result = canDeclareLate(ended, bookingId(2));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('SESSION_ENDED');
  });
});

describe('reordering for priority (FR-REC-15)', () => {
  it('requires a reason, because it goes into the audit log', () => {
    const { state } = running();

    const blank = canReorder(state, bookingId(3), '   ');
    expect(blank.ok).toBe(false);
    if (blank.ok) return;
    expect(blank.code).toBe('REASON_REQUIRED');

    expect(canReorder(state, bookingId(3), 'elderly').ok).toBe(true);
  });
});

describe('walk-ins (FR-REC-14)', () => {
  it('needs no reason to be added at the end', () => {
    const { state } = running();
    expect(canAddWalkin(state, 'end', null).ok).toBe(true);
  });

  it('needs a reason to jump ahead of waiting patients', () => {
    const { state } = running();

    const result = canAddWalkin(state, 'index', null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('REASON_REQUIRED');

    expect(canAddWalkin(state, 'index', 'referred by the ER').ok).toBe(true);
  });
});

describe('session controls', () => {
  it('allows the doctor to be marked arrived exactly once', () => {
    const { state, log } = session();
    expect(canDeclareDoctorArrived(state).ok).toBe(true);

    const arrived = reduce(
      state,
      log.next('DOCTOR_ARRIVED', { arrivedAt: PLANNED_START, minutesLate: 0 }),
    );

    const result = canDeclareDoctorArrived(arrived);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DOCTOR_ALREADY_ARRIVED');
  });

  it('accepts the delay durations the console offers, and rejects nonsense', () => {
    const { state } = running();

    for (const minutes of [15, 30, 45, 60]) {
      expect(canDeclareDelay(state, minutes).ok, `${String(minutes)} minutes`).toBe(true);
    }

    for (const minutes of [0, -30, 1.5, MAX_DELAY_MINUTES + 1]) {
      const result = canDeclareDelay(state, minutes);
      expect(result.ok, `${String(minutes)} minutes`).toBe(false);
      if (result.ok) continue;
      expect(result.code).toBe('DELAY_OUT_OF_RANGE');
    }
  });

  it('pauses and resumes in the right order', () => {
    const { state, log } = running();

    expect(canResume(state).ok).toBe(false);
    expect(canPause(state).ok).toBe(true);

    const paused = reduce(state, log.next('SESSION_PAUSED', { reason: 'prayer' }));

    expect(canPause(paused).ok).toBe(false);
    expect(canResume(paused).ok).toBe(true);
  });
});

describe('capacity', () => {
  it('counts a cancellation as a freed place, which is what makes recovery possible', () => {
    const seed = makeSeed(3);
    const capped = { plan: { ...seed.plan, capacity: 3 }, roster: seed.roster };
    const state = emptyState(capped);
    const log = new LogBuilder(capped.plan.sessionId);

    expect(hasCapacity(state)).toBe(false);

    const freed = reduce(
      state,
      log.next('BOOKING_CANCELLED', { bookingId: bookingId(2), reason: 'cancelled' }),
    );

    expect(hasCapacity(freed)).toBe(true);
  });

  it('is always available when a session has no cap', () => {
    const seed = makeSeed(3);
    const uncapped = { plan: { ...seed.plan, capacity: null }, roster: seed.roster };

    expect(hasCapacity(emptyState(uncapped))).toBe(true);
  });
});
