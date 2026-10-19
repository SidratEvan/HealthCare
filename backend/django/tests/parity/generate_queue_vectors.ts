/**
 * Generates the queue-engine parity vectors (`docs/django-migration/testing.md`).
 *
 * The TypeScript reducer is the reference. This drives it — and the guards,
 * the ETA, the rate, replay and the patients' view — over seeded logs, legal
 * ones from the domain suite's own generator and "chaos" ones that name
 * unknown bookings, arrive out of order and undo things, and writes every
 * input with every output to `vectors/queue.json`. `test_queue_parity.py`
 * feeds the same inputs to the Python port and requires the same outputs.
 *
 * Run from the repository root:
 *   pnpm --filter @platform/domain exec tsx ../../backend/django/tests/parity/generate_queue_vectors.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  generateLog,
  makeSeed,
  rng,
} from '../../../../shared/domain/src/queue/__tests__/support.js';
import {
  computeEtas,
  earlierThanTold,
  outstandingDelayMinutes,
  projectedEnd,
  twoAwayBookings,
} from '../../../../shared/domain/src/queue/eta.js';
import { patientViewOf } from '../../../../shared/domain/src/queue/patientView.js';
import { suggestedQuote } from '../../../../shared/domain/src/queue/quote.js';
import {
  observeConsult,
  rateSpreadSeconds,
  measuredConsultSeconds,
} from '../../../../shared/domain/src/queue/rate.js';
import { reduce } from '../../../../shared/domain/src/queue/reducer.js';
import {
  applyBatch,
  continueReplay,
  needsFullRebuild,
  replay,
} from '../../../../shared/domain/src/queue/replay.js';
import * as rules from '../../../../shared/domain/src/queue/rules.js';
import {
  checkInvariants,
  emptyState,
  project,
  queueCounts,
} from '../../../../shared/domain/src/queue/state.js';
import { timestamp } from '../../../../shared/domain/src/types/ids.js';

import type { QueueEvent } from '../../../../shared/domain/src/types/events.js';
import type { Timestamp } from '../../../../shared/domain/src/types/ids.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE_MS = Date.parse('2026-09-17T11:00:00.000Z');

const settings = { ...rules.DEFAULT_QUEUE_SETTINGS };

/** Deterministic stand-in for the server's keyed ticket. */
const ticket = (bookingId: string): string => `t-${[...bookingId].reverse().join('')}`;

function iso(ms: number): Timestamp {
  return timestamp(new Date(ms).toISOString());
}

const EVENT_TYPES = [
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
  'PATIENT_ARRIVED',
  'WALKIN_ADDED',
  'BOOKING_CANCELLED',
  'SLOT_OFFERED',
  'SLOT_ACCEPTED',
  'SLOT_EXPIRED',
  'PRIORITY_REORDERED',
  'SESSION_ENDED',
  'ACTION_UNDONE',
] as const;

/** A log of any events at all, legal or not, in a seeded order. */
function chaosLog(seedValue: number, size: number, steps: number): QueueEvent[] {
  const random = rng(seedValue);
  const int = (min: number, max: number): number => min + Math.floor(random() * (max - min + 1));
  const booking = (): string =>
    `33333333-3333-7333-8333-${String(int(1, size + 2)).padStart(12, '0')}`;
  const offer = (): string => `77777777-7777-7777-8777-${String(int(1, 4)).padStart(12, '0')}`;
  const events: QueueEvent[] = [];
  let at = BASE_MS + int(0, 600) * 1000;
  for (let n = 1; n <= steps; n += 1) {
    at += int(0, 900) * 1000;
    const type = EVENT_TYPES[int(0, EVENT_TYPES.length - 1)] ?? 'SESSION_OPENED';
    const payloads: Record<string, unknown> = {
      SESSION_OPENED: {},
      DOCTOR_ARRIVED: { arrivedAt: iso(at - int(0, 300) * 1000), minutesLate: int(-10, 60) },
      DELAY_DECLARED: {
        minutes: [0, 5, 15, 30, 45, 61][int(0, 5)],
        reason: random() < 0.5 ? null : 'ward round',
        declaredBy: random() < 0.5 ? 'doctor' : 'reception',
      },
      SESSION_PAUSED: { reason: random() < 0.5 ? null : 'prayer' },
      SESSION_RESUMED: {},
      PATIENT_CALLED: { bookingId: booking(), serial: int(1, size) },
      PATIENT_DONE: {
        bookingId: booking(),
        consultSeconds: [0, 12, 45, 300, 777.5, 5000][int(0, 5)],
      },
      PATIENT_LATE: { bookingId: booking(), expectedMinutes: int(5, 90), reinsertAfter: int(0, 5) },
      PATIENT_NO_SHOW: { bookingId: booking(), graceUsedMinutes: int(0, 40) },
      PATIENT_REINSERTED: { bookingId: booking(), newPosition: int(-2, size + 3) },
      PATIENT_ARRIVED: { bookingId: booking(), quotedWaitMinutes: int(0, 120) },
      WALKIN_ADDED: {
        bookingId: booking(),
        position: random() < 0.5 ? 'end' : 'index',
        index: random() < 0.3 ? null : int(0, size),
        reason: random() < 0.5 ? null : 'urgent',
      },
      BOOKING_CANCELLED: { bookingId: booking(), reason: random() < 0.5 ? null : 'travel' },
      SLOT_OFFERED: {
        offerId: offer(),
        freedBookingId: booking(),
        offeredTo: ['44444444-4444-7444-8444-000000000099'],
        expiresAt: iso(at + int(-5, 15) * 60_000),
      },
      SLOT_ACCEPTED: { offerId: offer(), newBookingId: booking() },
      SLOT_EXPIRED: { offerId: offer() },
      PRIORITY_REORDERED: {
        bookingId: booking(),
        fromIndex: int(0, size),
        toIndex: int(-1, size + 2),
        reason: 'elderly',
      },
      SESSION_ENDED: { reason: null },
      ACTION_UNDONE: {
        undoneEventId: `99999999-9999-7999-8999-${String(int(1, Math.max(1, n - 1))).padStart(12, '0')}`,
      },
    };
    events.push({
      id: `99999999-9999-7999-8999-${String(n).padStart(12, '0')}`,
      sessionId: '11111111-1111-7111-8111-111111111111',
      // Sometimes out of order, sometimes repeated: replay sorts, reduce skips.
      seq: random() < 0.1 ? int(1, n) : n,
      serverTs: iso(at),
      clientTs: null,
      clientEventId:
        random() < 0.2 ? null : `88888888-8888-7888-8888-${String(n).padStart(12, '0')}`,
      actor: { kind: 'system', job: 'parity' },
      type,
      payload: payloads[type],
    } as QueueEvent);
  }
  return events;
}

function shuffle<T>(items: readonly T[], seedValue: number): T[] {
  const random = rng(seedValue * 7 + 3);
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    const held = out[index] as T;
    out[index] = out[other] as T;
    out[other] = held;
  }
  return out;
}

function guardsAt(state: ReturnType<typeof emptyState>, now: Timestamp): Record<string, unknown> {
  const out: Record<string, unknown> = {
    canDeclareDoctorArrived: rules.canDeclareDoctorArrived(state),
    canDeclareDelay: [0, 1, 30, 480, 481, 2.5].map((m) => rules.canDeclareDelay(state, m)),
    canPause: rules.canPause(state),
    canResume: rules.canResume(state),
    canCallNext: rules.canCallNext(state),
    nextToCall: rules.nextToCall(state)?.bookingId ?? null,
    canEndSession: rules.canEndSession(state),
    unseenAtEnd: rules.unseenAtEnd(state),
    hasCapacity: rules.hasCapacity(state),
    canAddWalkin: [
      rules.canAddWalkin(state, 'end', null),
      rules.canAddWalkin(state, 'index', null),
      rules.canAddWalkin(state, 'index', ' x '),
    ],
    lapsedOffers: rules.lapsedOffers(state, now).map((o) => o.offerId),
    canReplayOffline: [
      rules.canReplayOffline('PATIENT_CALLED', ['doctor']),
      rules.canReplayOffline('PATIENT_NO_SHOW', ['doctor']),
      rules.canReplayOffline('ACTION_UNDONE', ['receptionist']),
    ],
    graceWindowMinutes: rules.graceWindowMinutes(state, settings),
    perBooking: state.entries.map((entry) => ({
      bookingId: entry.bookingId,
      canMarkDone: rules.canMarkDone(state, entry.bookingId),
      canMarkNoShow: rules.canMarkNoShow(state, entry.bookingId, settings, now),
      graceRemaining: rules.graceRemaining(state, entry.bookingId, settings, now),
      canCheckIn: [0, 25, 480, 481, 1.5].map((q) => rules.canCheckIn(state, entry.bookingId, q)),
      canReinstate: rules.canReinstate(state, entry.bookingId),
      canDeclareLate: rules.canDeclareLate(state, entry.bookingId),
      lateReinsertIndex: rules.lateReinsertIndex(state, entry.bookingId, 3),
      canReorder: [
        rules.canReorder(state, entry.bookingId, '  '),
        rules.canReorder(state, entry.bookingId, 'elderly'),
      ],
      canOfferFreedSlot: rules.canOfferFreedSlot(state, entry.bookingId),
      suggestedQuote: suggestedQuote(state, entry.bookingId, now),
    })),
    canAcceptSlot: state.offers.map((o) => rules.canAcceptSlot(state, o.offerId, now)),
  };
  return out;
}

function observe(
  state: ReturnType<typeof emptyState>,
  nows: readonly Timestamp[],
): Record<string, unknown> {
  const etas = nows.map((now) => computeEtas(state, now));
  const told = new Map(
    state.entries.map((e, i) => [e.bookingId, iso(BASE_MS + i * 240_000)] as const),
  );
  return {
    state,
    project: project(state),
    counts: queueCounts(state),
    invariants: checkInvariants(state),
    spread: rateSpreadSeconds(state.rate),
    etas,
    etasWithPrevious: computeEtas(state, nows[0] ?? iso(BASE_MS), { previous: told }),
    earlierThanTold: earlierThanTold(state, etas[0] ?? [], told, state.plan.plannedStart).map(
      (e) => e.bookingId,
    ),
    outstandingDelay: nows.map((now) => outstandingDelayMinutes(state, now)),
    projectedEnd: nows.map((now) => projectedEnd(state, now)),
    twoAway: twoAwayBookings(state),
    patientView: patientViewOf(state, etas[0] ?? [], ticket as never),
    guards: guardsAt(state, nows[1] ?? iso(BASE_MS)),
  };
}

interface Case {
  readonly name: string;
  readonly seed: ReturnType<typeof makeSeed>;
  readonly events: readonly QueueEvent[];
  readonly shuffled: readonly QueueEvent[];
  readonly nows: readonly Timestamp[];
  readonly steps: readonly Record<string, unknown>[];
  readonly replayed: unknown;
  readonly replayedShuffled: unknown;
  readonly continued: unknown;
  readonly needsFullRebuild: boolean;
  readonly batch: unknown;
}

function buildCase(
  name: string,
  seed: ReturnType<typeof makeSeed>,
  events: readonly QueueEvent[],
  seedValue: number,
): Case {
  const last = events.at(-1)?.serverTs ?? iso(BASE_MS);
  const lastMs = Date.parse(last);
  const nows = [iso(lastMs + 30_000), iso(lastMs + 17 * 60_000 + 500), iso(BASE_MS - 3_600_000)];

  // State after every event, through `reduce` one at a time.
  const steps: Record<string, unknown>[] = [];
  let state = emptyState(seed);
  for (const [index, event] of events.entries()) {
    state = reduce(state, event);
    // Observing everything after every event makes a big file; every third
    // step, and the last, is plenty.
    if (index % 3 === 0 || index === events.length - 1)
      steps.push({ index, ...observe(state, nows) });
  }

  const half = Math.floor(events.length / 2);
  const firstHalf = replay(seed, events.slice(0, half));
  return {
    name,
    seed,
    events,
    shuffled: shuffle(events, seedValue),
    nows,
    steps,
    replayed: replay(seed, events),
    replayedShuffled: replay(seed, shuffle(events, seedValue)),
    continued: continueReplay(firstHalf, events.slice(half)),
    needsFullRebuild: needsFullRebuild(firstHalf, events.slice(half)),
    batch: applyBatch(firstHalf, events.slice(half)),
  };
}

const cases: Case[] = [];
for (let seedValue = 1; seedValue <= 40; seedValue += 1) {
  const seed = makeSeed(4 + (seedValue % 9), {
    defaultConsultSeconds: [300, 480, 777, 31][seedValue % 4] ?? 480,
  });
  cases.push(
    buildCase(
      `legal-${seedValue}`,
      seed,
      generateLog(seed, seedValue, 45, { withUndo: seedValue % 3 === 0 }),
      seedValue,
    ),
  );
  cases.push(
    buildCase(`chaos-${seedValue}`, seed, chaosLog(seedValue, 4 + (seedValue % 9), 40), seedValue),
  );
}

// The rate on its own, over awkward values.
const rateCases = [
  0,
  1,
  29,
  30,
  30.5,
  31,
  299.5,
  300,
  3599.5,
  3600,
  3601,
  7200,
  -5,
  Number.NaN,
].map((seconds) => ({
  seconds,
  observed: observeConsult({ seedSeconds: 480, currentSeconds: 480, samples: [300, 600] }, seconds),
}));
const measured = [
  [null, iso(BASE_MS)],
  [iso(BASE_MS), iso(BASE_MS + 10)],
  [iso(BASE_MS), iso(BASE_MS + 500)],
  [iso(BASE_MS), iso(BASE_MS + 1500)],
  [iso(BASE_MS), iso(BASE_MS + 4 * 3600_000)],
  [iso(BASE_MS + 9000), iso(BASE_MS)],
].map(([calledAt, now]) => ({
  calledAt,
  now,
  seconds: measuredConsultSeconds(calledAt ?? null, now ?? iso(BASE_MS)),
}));

const out = join(HERE, 'vectors', 'queue.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ settings, cases, rateCases, measured }));
console.log(`wrote ${String(cases.length)} cases to ${out}`);
