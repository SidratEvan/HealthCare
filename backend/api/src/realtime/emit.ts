/**
 * Typed emitters, and the seam the transport plugs into (BACKEND.md §3).
 *
 * ## Why there is an interface here at all
 *
 * BACKEND.md §0 fixes Socket.IO as the transport, and that is what will be
 * behind this. The interface exists for two reasons that outlive the choice:
 *
 * A broadcast is a side effect a service performs, and services are the only
 * layer allowed to perform one (CLAUDE.md §7). Keeping the transport behind a
 * narrow interface means the layering rule has something to point at — a
 * repository importing `socket.io` fails lint, a repository importing this
 * file fails lint, and neither depends on remembering.
 *
 * And it makes the broadcast assertable. `NFR-01` is a two-second promise from
 * a reception tap to a patient's phone, and the test that proves the queue
 * service broadcasts at all should not need a socket server, a port and a
 * client connection to do it.
 *
 * The queue service calls `emitter().queueUpdated(...)` and does not know or
 * care what is on the other side.
 */

import type { Eta, QueueState } from '@platform/domain';

import { logger } from '../config/logger.js';

import { ROOMS, type RealtimeEnvelope } from './rooms.js';

/** What a transport must be able to do. Deliberately tiny. */
export interface RealtimeEmitter {
  /** Publishes one envelope into one room. */
  emit(room: string, event: string, envelope: RealtimeEnvelope): void;
}

/**
 * The payload a session room receives after any queue mutation.
 *
 * `{ seq, state, etas, serverTs }` exactly as BACKEND.md §4.1 step 10 names
 * it. A client folds it by `seq`: anything at or below what it already has is
 * a duplicate it must ignore, which is what makes an optimistic console and a
 * reconnecting socket converge instead of double-counting (`SY-01`).
 */
export interface QueueUpdatedPayload {
  readonly state: QueueState;
  readonly etas: readonly Eta[];
}

/**
 * Records every emission instead of sending it.
 *
 * The default until the socket server is wired in, and what the tests assert
 * against. It is not a stub standing in for missing behaviour: a queue
 * mutation that reaches this has done everything the request asked of it, and
 * the only thing missing is a listener.
 */
export class RecordingEmitter implements RealtimeEmitter {
  private readonly sent: { room: string; event: string; envelope: RealtimeEnvelope }[] = [];

  emit(room: string, event: string, envelope: RealtimeEnvelope): void {
    this.sent.push({ room, event, envelope });
    logger.debug({ room, event, seq: envelope.seq }, 'realtime emit');
  }

  /** Everything emitted, oldest first. */
  all(): readonly { room: string; event: string; envelope: RealtimeEnvelope }[] {
    return this.sent;
  }

  /** Everything emitted into one room. */
  forRoom(room: string): readonly { event: string; envelope: RealtimeEnvelope }[] {
    return this.sent.filter((entry) => entry.room === room);
  }

  clear(): void {
    this.sent.length = 0;
  }
}

let current: RealtimeEmitter = new RecordingEmitter();

/** The emitter services publish through. */
export function emitter(): RealtimeEmitter {
  return current;
}

/**
 * Replaces the emitter.
 *
 * Called once at boot by `server.ts` when the socket server exists, and by
 * tests that want to assert on what was published.
 */
export function setEmitter(next: RealtimeEmitter): void {
  current = next;
}

/** Restores the recording default. */
export function resetEmitter(): RecordingEmitter {
  const fresh = new RecordingEmitter();
  current = fresh;
  return fresh;
}

// ---------------------------------------------------------------------------
// The typed publishers services actually call
// ---------------------------------------------------------------------------

/**
 * `queue.updated` — the broadcast the whole product is built around.
 *
 * Every waiting patient's phone updates from this (`FR-QUE-40`, `NFR-01`: two
 * seconds end to end). It carries the full state rather than a delta, because
 * a client that missed one message must not be left holding a queue that is
 * quietly wrong; the resume-from-seq path exists for the case where a client
 * wants the events it missed instead.
 */
export function queueUpdated(
  sessionId: string,
  payload: QueueUpdatedPayload,
  seq: number,
  serverTs: string,
): void {
  emitter().emit(ROOMS.session(sessionId), 'queue.updated', {
    type: 'queue.updated',
    seq,
    serverTs,
    data: payload,
  });
}

/** `session.delayed` — a declared delay, so a client can show it at once. */
export function sessionDelayed(
  sessionId: string,
  data: {
    readonly minutes: number;
    readonly totalDelayMinutes: number;
    readonly reason: string | null;
  },
  seq: number,
  serverTs: string,
): void {
  emitter().emit(ROOMS.session(sessionId), 'session.delayed', {
    type: 'session.delayed',
    seq,
    serverTs,
    data,
  });
}

/** `session.ended` — stop polling, the chamber is closed (`FR-REC-06`). */
export function sessionEnded(sessionId: string, seq: number, serverTs: string): void {
  emitter().emit(ROOMS.session(sessionId), 'session.ended', {
    type: 'session.ended',
    seq,
    serverTs,
    data: {},
  });
}

/**
 * `patient.called` — targeted at one patient (BACKEND.md §6).
 *
 * Emitted into the patient's own room rather than the session's, because
 * "you are being called now" is addressed to one person and the rest of the
 * waiting room has no business receiving it.
 */
export function patientCalled(
  patientId: string,
  data: { readonly sessionId: string; readonly bookingId: string; readonly serial: number },
  seq: number,
  serverTs: string,
): void {
  emitter().emit(ROOMS.patient(patientId), 'patient.called', {
    type: 'patient.called',
    seq,
    serverTs,
    data,
  });
}
