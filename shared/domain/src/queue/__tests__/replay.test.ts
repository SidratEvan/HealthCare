/**
 * Replay determinism (FR-QUE-05).
 *
 * "Replaying the log for a session reproduces its exact state. This is the
 * debugging and dispute-resolution mechanism." That sentence is only worth
 * something if it is true for logs nobody thought to write by hand, so most of
 * this file is properties checked against seeded random logs rather than
 * examples.
 *
 * A failure here names the seed, which reproduces the exact log while it is
 * being fixed.
 */

import { describe, expect, it } from 'vitest';

import { serial, timestamp, type QueueEventId } from '../../types/ids.js';
import { applyBatch, continueReplay, needsFullRebuild, orderEvents, replay } from '../replay.js';
import { checkInvariants, emptyState } from '../state.js';

import { bookingId, chunk, generateLog, LogBuilder, makeSeed, queueShape, rng } from './support.js';

/** Enough seeds to cover the shapes the generator can produce. */
const SEEDS = Array.from({ length: 60 }, (_, index) => index + 1);

describe('replay is deterministic', () => {
  it.each(SEEDS)('produces the same state twice for seed %i', (seed) => {
    const queueSeed = makeSeed(8);
    const events = generateLog(queueSeed, seed, 40);

    expect(replay(queueSeed, events)).toEqual(replay(queueSeed, events));
  });

  it.each(SEEDS)('is independent of the order events arrive in, for seed %i', (seed) => {
    const queueSeed = makeSeed(8);
    const events = generateLog(queueSeed, seed, 40);

    // An offline console sends its batch in client-timestamp order; the server
    // orders by seq, which is authoritative (SY-01).
    const shuffled = shuffle(events, seed);

    expect(queueShape(replay(queueSeed, shuffled))).toEqual(queueShape(replay(queueSeed, events)));
  });

  it.each(SEEDS)('reads the same whether folded whole or in chunks, for seed %i', (seed) => {
    const queueSeed = makeSeed(8);
    const events = generateLog(queueSeed, seed, 40);

    const whole = replay(queueSeed, events);

    // Three different chunk boundaries, as three different reconnect patterns.
    for (const parts of [2, 3, 7]) {
      const incremental = chunk(events, parts).reduce(
        (state, batch) => continueReplay(state, batch),
        emptyState(queueSeed),
      );
      expect(queueShape(incremental), `chunked into ${String(parts)}`).toEqual(queueShape(whole));
    }
  });

  it.each(SEEDS)('never violates a structural invariant, for seed %i', (seed) => {
    const queueSeed = makeSeed(8);
    const events = generateLog(queueSeed, seed, 40);

    expect(checkInvariants(replay(queueSeed, events))).toEqual([]);
  });

  it.each(SEEDS)('records no anomaly for a legally generated log, for seed %i', (seed) => {
    const queueSeed = makeSeed(8);
    const events = generateLog(queueSeed, seed, 40);

    // The generator only emits actions the state allows, so any anomaly here is
    // the reducer misreading a legal log rather than the log being wrong.
    expect(replay(queueSeed, events).anomalies).toEqual([]);
  });

  it('is independent of when it is run, which is what makes it evidence', () => {
    const queueSeed = makeSeed(10);
    const events = generateLog(queueSeed, 7, 50);

    // No clock is read anywhere in the fold — lint forbids it in this
    // directory — so a replay a year from now settles a dispute the same way.
    const first = replay(queueSeed, events);
    const second = replay(queueSeed, events);

    expect(first).toEqual(second);
    expect(first.lastEventAt).toBe(second.lastEventAt);
  });
});

describe('undo nets the pair out (GR-02)', () => {
  it('leaves the queue as though the undone action never happened', () => {
    const seed = makeSeed(5);
    const log = new LogBuilder(seed.plan.sessionId);

    const arrived = log.next('DOCTOR_ARRIVED', {
      arrivedAt: timestamp('2026-09-17T11:00:00.000Z'),
      minutesLate: 0,
    });
    const called = log.next('PATIENT_CALLED', { bookingId: bookingId(1), serial: serial(1) });
    const mistake = log.next('PATIENT_NO_SHOW', {
      bookingId: bookingId(2),
      graceUsedMinutes: 16,
    });
    const undo = log.next('ACTION_UNDONE', { undoneEventId: mistake.id });

    const withMistakeUndone = replay(seed, [arrived, called, mistake, undo]);
    const asIfNeverHappened = replay(seed, [arrived, called]);

    expect(queueShape(withMistakeUndone)).toEqual(queueShape(asIfNeverHappened));
  });

  it('keeps both events in the log — history is never deleted', () => {
    const seed = makeSeed(3);
    const log = new LogBuilder(seed.plan.sessionId);

    const mistake = log.next('DELAY_DECLARED', {
      minutes: 30,
      reason: 'mis-tap',
      declaredBy: 'reception',
    });
    const undo = log.next('ACTION_UNDONE', { undoneEventId: mistake.id });

    const state = replay(seed, [mistake, undo]);

    expect(state.delayMinutes).toBe(0);
    expect(state.undoneEventIds).toEqual([mistake.id]);
    // The cursor still moved past both: the events exist.
    expect(state.lastSeq).toBe(undo.seq);
  });

  it('undoes a call, putting the patient back in the queue', () => {
    const seed = makeSeed(4);
    const log = new LogBuilder(seed.plan.sessionId);

    const arrived = log.next('DOCTOR_ARRIVED', {
      arrivedAt: timestamp('2026-09-17T11:00:00.000Z'),
      minutesLate: 0,
    });
    const called = log.next('PATIENT_CALLED', { bookingId: bookingId(2), serial: serial(2) });
    const undo = log.next('ACTION_UNDONE', { undoneEventId: called.id });

    const state = replay(seed, [arrived, called, undo]);

    expect(state.entries.every((entry) => entry.status !== 'in_chamber')).toBe(true);
    expect(state.entries.every((entry) => entry.calledAt === null)).toBe(true);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'stays deterministic with undo in the mix, for seed %i',
    (seed) => {
      const queueSeed = makeSeed(8);
      const events = generateLog(queueSeed, seed, 40, { withUndo: true });

      expect(replay(queueSeed, events)).toEqual(replay(queueSeed, events));
      expect(checkInvariants(replay(queueSeed, events))).toEqual([]);
    },
  );
});

describe('needsFullRebuild', () => {
  it('is false when the undone event is in the same batch', () => {
    const seed = makeSeed(3);
    const log = new LogBuilder(seed.plan.sessionId);

    const mistake = log.next('DELAY_DECLARED', {
      minutes: 30,
      reason: null,
      declaredBy: 'reception',
    });
    const undo = log.next('ACTION_UNDONE', { undoneEventId: mistake.id });

    expect(needsFullRebuild(emptyState(seed), [mistake, undo])).toBe(false);
  });

  it('is true when the undone event was folded into the cache earlier', () => {
    const seed = makeSeed(3);
    const log = new LogBuilder(seed.plan.sessionId);

    const mistake = log.next('DELAY_DECLARED', {
      minutes: 30,
      reason: null,
      declaredBy: 'reception',
    });
    const cached = replay(seed, [mistake]);
    const undo = log.next('ACTION_UNDONE', { undoneEventId: mistake.id });

    // A fold cannot un-apply, so the cache has to be rebuilt from the seed —
    // which is exactly what queue.service.getState does when this is true.
    expect(needsFullRebuild(cached, [undo])).toBe(true);

    const rebuilt = replay(seed, [mistake, undo]);
    expect(rebuilt.delayMinutes).toBe(0);
  });

  it('is false for a batch with no undo at all', () => {
    const seed = makeSeed(3);
    const events = generateLog(seed, 42, 20);

    expect(needsFullRebuild(emptyState(seed), events)).toBe(false);
  });
});

describe('orderEvents', () => {
  it('sorts by the server sequence, not by arrival', () => {
    const seed = makeSeed(3);
    const log = new LogBuilder(seed.plan.sessionId);

    const first = log.next('SESSION_OPENED', {});
    const second = log.next('DELAY_DECLARED', {
      minutes: 15,
      reason: null,
      declaredBy: 'reception',
    });
    const third = log.next('SESSION_ENDED', { reason: null });

    expect(orderEvents([third, first, second]).map((event) => event.seq)).toEqual([
      first.seq,
      second.seq,
      third.seq,
    ]);
  });

  it('breaks a seq tie on event id, so the result is one canonical order', () => {
    const seed = makeSeed(2);
    const log = new LogBuilder(seed.plan.sessionId);
    const a = log.next('SESSION_OPENED', {});
    const b = { ...log.next('SESSION_RESUMED', {}), seq: a.seq };

    expect(orderEvents([b, a]).map((event) => event.id)).toEqual(
      orderEvents([a, b]).map((event) => event.id),
    );
  });
});

describe('applyBatch reports what an offline console needs (SY-05)', () => {
  it('accepts every event that took effect', () => {
    const seed = makeSeed(5);
    const log = new LogBuilder(seed.plan.sessionId);

    const events = [
      log.next('DOCTOR_ARRIVED', {
        arrivedAt: timestamp('2026-09-17T11:00:00.000Z'),
        minutesLate: 5,
      }),
      log.next('PATIENT_CALLED', { bookingId: bookingId(1), serial: serial(1) }),
      log.advance(300).next('PATIENT_DONE', { bookingId: bookingId(1), consultSeconds: 300 }),
    ];

    const outcome = applyBatch(emptyState(seed), events);

    expect(outcome.accepted).toHaveLength(3);
    expect(outcome.conflicts).toEqual([]);
    expect(outcome.state.rate.currentSeconds).toBe(300);
  });

  it('reports the event that referenced something no longer true as a conflict', () => {
    const seed = makeSeed(3);
    const log = new LogBuilder(seed.plan.sessionId);

    const good = log.next('DOCTOR_ARRIVED', {
      arrivedAt: timestamp('2026-09-17T11:00:00.000Z'),
      minutesLate: 0,
    });
    const orphan = log.next('PATIENT_DONE', {
      bookingId: bookingId(999),
      consultSeconds: 200,
    });

    const outcome = applyBatch(emptyState(seed), [good, orphan]);

    expect(outcome.accepted.map((entry) => entry.seq)).toEqual([good.seq]);
    expect(outcome.conflicts).toHaveLength(1);
    expect(outcome.conflicts[0]?.clientEventId).toBe(orphan.clientEventId);
    // The device needs a sentence it can put in a toast, not a code.
    expect(outcome.conflicts[0]?.reason).toContain('roster');
  });

  it('ignores system events, which no device is waiting to reconcile', () => {
    const seed = makeSeed(3);
    const log = new LogBuilder(seed.plan.sessionId);
    const systemEvent = { ...log.next('SESSION_OPENED', {}), clientEventId: null };

    const outcome = applyBatch(emptyState(seed), [systemEvent]);

    expect(outcome.accepted).toEqual([]);
    expect(outcome.conflicts).toEqual([]);
    expect(outcome.state.openedAt).not.toBeNull();
  });

  it('is idempotent: replaying a batch that already landed changes nothing', () => {
    const seed = makeSeed(6);
    const events = generateLog(seed, 11, 30);

    const once = replay(seed, events);
    const twice = continueReplay(once, events);

    // Every event carries a client_event_id and the database rejects a repeat
    // (FR-QUE-51); the reducer is idempotent over the same log for the same
    // reason a replay is deterministic.
    expect(queueShape(twice)).toEqual(queueShape(once));
  });
});

describe('a session that has been offline all day', () => {
  it('folds a long log inside the recalculation budget (NFR-03)', () => {
    const seed = makeSeed(100);
    const events = generateLog(seed, 99, 600);

    const startedAt = Date.now();
    const state = replay(seed, events);
    const elapsedMs = Date.now() - startedAt;

    expect(checkInvariants(state)).toEqual([]);
    // FR-QUE-14 budgets 500 ms for recalculation on a 100-patient session.
    // A full replay of a whole day's log is a far heavier operation than one
    // recalculation, so passing here leaves the real budget comfortable.
    expect(elapsedMs).toBeLessThan(500);
  });
});

/** Fisher-Yates with the seeded generator, so a shuffle is reproducible. */
function shuffle<T>(items: readonly T[], seedValue: number): readonly T[] {
  const random = rng(seedValue * 7919);
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const a = copy[index];
    const b = copy[swap];
    if (a !== undefined && b !== undefined) {
      copy[index] = b;
      copy[swap] = a;
    }
  }
  return copy;
}

/** Guards against a typo in the support module silently weakening every test. */
describe('the generator itself', () => {
  it('produces a non-trivial log', () => {
    const seed = makeSeed(8);
    const events = generateLog(seed, 3, 40);

    expect(events.length).toBeGreaterThan(10);
    expect(new Set(events.map((event) => event.type)).size).toBeGreaterThan(3);
  });

  it('gives a different log for a different seed', () => {
    const seed = makeSeed(8);
    const a = generateLog(seed, 1, 40).map((event) => event.type);
    const b = generateLog(seed, 2, 40).map((event) => event.type);

    expect(a).not.toEqual(b);
  });

  it('gives the same log for the same seed', () => {
    const seed = makeSeed(8);
    const ids = (events: readonly { id: QueueEventId }[]): readonly QueueEventId[] =>
      events.map((event) => event.id);

    expect(ids(generateLog(seed, 5, 40))).toEqual(ids(generateLog(seed, 5, 40)));
  });
});
