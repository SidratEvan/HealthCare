/**
 * Test support for the queue engine: a seeded random generator that walks the
 * state machine and produces *legal* event logs.
 *
 * Hand-written logs test the cases someone thought of. A generator tests the
 * ones nobody did — a patient declaring lateness from the front of the queue
 * while a slot offer is outstanding and the session is paused — which is where
 * a reducer bug actually hides. The generator is seeded, so a failure names an
 * exact log that can be replayed while it is being fixed.
 */

import {
  id,
  serial as asSerial,
  timestamp,
  type BookingId,
  type ClientEventId,
  type DoctorId,
  type PatientId,
  type QueueEventId,
  type SessionId,
  type SlotOfferId,
} from '../../types/ids.js';
import { reduce } from '../reducer.js';
import {
  activeQueue,
  emptyState,
  nowServing,
  waitingQueue,
  type QueueSeed,
  type QueueState,
} from '../state.js';

import type { QueueEvent } from '../../types/events.js';

/** Deterministic PRNG (mulberry32). Same seed, same log, every run. */
export function rng(seedValue: number): () => number {
  let state = seedValue >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(random() * items.length)];
}

function pickInt(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

const BASE_MS = Date.parse('2026-09-17T11:00:00.000Z');

/** A session with `size` pre-booked patients, planned to start at 11:00 UTC. */
export function makeSeed(size = 8, options: { defaultConsultSeconds?: number } = {}): QueueSeed {
  const sessionId = id<SessionId>('11111111-1111-7111-8111-111111111111');

  return {
    plan: {
      sessionId,
      doctorId: id<DoctorId>('22222222-2222-7222-8222-222222222222'),
      plannedStart: timestamp(new Date(BASE_MS).toISOString()),
      plannedEnd: timestamp(new Date(BASE_MS + 3 * 3600_000).toISOString()),
      capacity: 40,
      defaultConsultSeconds: options.defaultConsultSeconds ?? 480,
    },
    roster: Array.from({ length: size }, (_, index) => ({
      bookingId: bookingId(index + 1),
      serial: asSerial(index + 1),
      patientId: id<PatientId>(`44444444-4444-7444-8444-${String(index + 1).padStart(12, '0')}`),
      source: 'app' as const,
      createdAt: timestamp(new Date(BASE_MS - 86_400_000 + index * 1000).toISOString()),
    })),
  };
}

export function bookingId(n: number): BookingId {
  return id<BookingId>(`33333333-3333-7333-8333-${String(n).padStart(12, '0')}`);
}

/** Builds events with monotonic seq and server timestamps. */
export class LogBuilder {
  private seq = 0;
  private offsetSeconds = 0;

  constructor(private readonly sessionId: SessionId) {}

  /** Advances the clock, so successive events are not simultaneous. */
  advance(seconds: number): this {
    this.offsetSeconds += seconds;
    return this;
  }

  /**
   * Builds one event. The payload is narrowed by `type`, so a wrong payload is
   * a compile error at the call site — which is the point of the helper.
   *
   * The return type is the whole union rather than the narrowed member: for a
   * generic `T`, TypeScript cannot prove that `{type: T, payload: P<T>}`
   * inhabits exactly one member of a discriminated union, so narrowing it
   * would need a double assertion. Tests read only the common fields.
   */
  next<T extends QueueEvent['type']>(
    type: T,
    payload: Extract<QueueEvent, { type: T }>['payload'],
  ): QueueEvent {
    this.seq += 1;
    const event = {
      id: id<QueueEventId>(`99999999-9999-7999-8999-${String(this.seq).padStart(12, '0')}`),
      sessionId: this.sessionId,
      seq: this.seq,
      serverTs: timestamp(new Date(BASE_MS + this.offsetSeconds * 1000).toISOString()),
      clientTs: null,
      clientEventId: id<ClientEventId>(
        `88888888-8888-7888-8888-${String(this.seq).padStart(12, '0')}`,
      ),
      actor: { kind: 'system' as const, job: 'test' },
      type,
      payload,
    };
    return event as QueueEvent;
  }
}

/**
 * Generates a legal log by repeatedly choosing an action the current state
 * allows, then folding it in.
 *
 * Only actions the state permits are emitted, so a log from here should
 * produce no anomalies at all — which makes "anomalies is empty" a meaningful
 * assertion rather than a tautology.
 */
export function generateLog(
  seed: QueueSeed,
  seedValue: number,
  steps: number,
  options: { readonly withUndo?: boolean } = {},
): readonly QueueEvent[] {
  const random = rng(seedValue);
  const builder = new LogBuilder(seed.plan.sessionId);
  const events: QueueEvent[] = [];

  let state = emptyState(seed);
  let offerCounter = 0;

  const emit = (event: QueueEvent): void => {
    events.push(event);
    state = reduce(state, event);
  };

  emit(builder.advance(pickInt(random, 0, 60)).next('SESSION_OPENED', {}));

  for (let step = 0; step < steps; step += 1) {
    builder.advance(pickInt(random, 20, 400));

    if (state.status === 'ended') break;

    // Get the doctor in before anything else can happen.
    if (state.doctorArrivedAt === null) {
      if (random() < 0.7) {
        emit(
          builder.next('DOCTOR_ARRIVED', {
            arrivedAt: timestamp(new Date(BASE_MS + 600_000).toISOString()),
            minutesLate: pickInt(random, -5, 45),
          }),
        );
      } else {
        emit(
          builder.next('DELAY_DECLARED', {
            minutes: pick(random, [15, 30, 45, 60]) ?? 30,
            reason: 'surgery',
            declaredBy: random() < 0.5 ? 'doctor' : 'reception',
          }),
        );
      }
      continue;
    }

    if (state.status === 'paused') {
      emit(builder.next('SESSION_RESUMED', {}));
      continue;
    }

    const serving = nowServing(state);
    const roll = random();

    if (serving !== null) {
      // Someone is in the chamber: finish them, or occasionally pause first.
      if (roll < 0.85) {
        emit(
          builder.next('PATIENT_DONE', {
            bookingId: serving.bookingId,
            consultSeconds: pickInt(random, 60, 1500),
          }),
        );
      } else {
        emit(builder.next('SESSION_PAUSED', { reason: 'prayer' }));
      }
      continue;
    }

    const waiting = waitingQueue(state);
    if (waiting.length === 0) {
      emit(builder.next('SESSION_ENDED', { reason: null }));
      break;
    }

    if (roll < 0.5) {
      const target = waiting[0];
      if (target !== undefined) {
        emit(
          builder.next('PATIENT_CALLED', {
            bookingId: target.bookingId,
            serial: target.serial,
          }),
        );
      }
      continue;
    }

    if (roll < 0.6) {
      const target = pick(random, waiting);
      if (target !== undefined) {
        emit(
          builder.next('PATIENT_LATE', {
            bookingId: target.bookingId,
            expectedMinutes: pick(random, [10, 20, 30, 45]) ?? 20,
            reinsertAfter: pickInt(random, 1, 4),
          }),
        );
      }
      continue;
    }

    if (roll < 0.68) {
      const target = waiting[0];
      if (target !== undefined) {
        emit(
          builder.next('PATIENT_NO_SHOW', {
            bookingId: target.bookingId,
            graceUsedMinutes: pickInt(random, 15, 30),
          }),
        );
      }
      continue;
    }

    if (roll < 0.74) {
      const absent = state.entries.filter((entry) => entry.status === 'no_show');
      const target = pick(random, absent);
      if (target !== undefined) {
        emit(
          builder.next('PATIENT_REINSERTED', {
            bookingId: target.bookingId,
            newPosition: pickInt(random, 0, Math.max(0, activeQueue(state).length)),
          }),
        );
      }
      continue;
    }

    if (roll < 0.8) {
      const target = pick(random, waiting);
      if (target !== undefined) {
        emit(
          builder.next('PRIORITY_REORDERED', {
            bookingId: target.bookingId,
            fromIndex: 0,
            toIndex: pickInt(random, 0, Math.max(0, activeQueue(state).length - 1)),
            reason: 'elderly',
          }),
        );
      }
      continue;
    }

    if (roll < 0.86) {
      const target = pick(random, waiting);
      if (target !== undefined) {
        emit(
          builder.next('BOOKING_CANCELLED', {
            bookingId: target.bookingId,
            reason: 'patient cancelled',
          }),
        );
      }
      continue;
    }

    if (roll < 0.92) {
      const freed = pick(
        random,
        state.entries.filter((entry) => entry.status === 'no_show'),
      );
      if (freed !== undefined) {
        offerCounter += 1;
        emit(
          builder.next('SLOT_OFFERED', {
            offerId: id<SlotOfferId>(
              `55555555-5555-7555-8555-${String(offerCounter).padStart(12, '0')}`,
            ),
            freedBookingId: freed.bookingId,
            offeredTo: [freed.patientId],
            expiresAt: timestamp(new Date(BASE_MS + 7200_000).toISOString()),
          }),
        );
      }
      continue;
    }

    if (options.withUndo === true && events.length > 2) {
      const undoable = pick(random, events.slice(1));
      if (undoable !== undefined && undoable.type !== 'ACTION_UNDONE') {
        emit(builder.next('ACTION_UNDONE', { undoneEventId: undoable.id }));
      }
      continue;
    }

    emit(
      builder.next('DELAY_DECLARED', {
        minutes: pick(random, [15, 30]) ?? 15,
        reason: null,
        declaredBy: 'reception',
      }),
    );
  }

  return events;
}

/**
 * The part of a state two different derivations must agree on.
 *
 * Excludes `lastSeq`, `lastEventAt` and `undoneEventIds`, which legitimately
 * differ between "a log with an event and its undo" and "a log without either"
 * while the queue itself is identical. What a patient and a receptionist see
 * is this.
 */
export function queueShape(state: QueueState): unknown {
  return {
    status: state.status,
    doctorArrivedAt: state.doctorArrivedAt,
    delayMinutes: state.delayMinutes,
    pausedSeconds: state.pausedSeconds,
    rate: state.rate,
    entries: state.entries.map((entry) => ({
      bookingId: entry.bookingId,
      serial: entry.serial,
      status: entry.status,
      calledAt: entry.calledAt,
      doneAt: entry.doneAt,
      consultSeconds: entry.consultSeconds,
      late: entry.late,
      noShow: entry.noShow,
    })),
    offers: state.offers,
  };
}

/** Splits a log into `parts` contiguous chunks, as an offline sync would. */
export function chunk<T>(items: readonly T[], parts: number): readonly T[][] {
  const size = Math.ceil(items.length / Math.max(1, parts));
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
