/**
 * Subscribe, unsubscribe, and resume-from-seq (BACKEND.md §6).
 *
 * ## The resume handshake is the interesting part
 *
 * "Client sends `lastSeq`; server replays missed events from `queue_events`
 * before streaming live (`SY-01`)."
 *
 * That is what makes a dropped connection a non-event for a patient standing
 * in a corridor with one bar of signal. Their phone reconnects, says "I had up
 * to sequence 47", and receives 48 onwards — rather than a fresh snapshot that
 * may have skipped the moment they were called.
 *
 * A client that sends no `lastSeq` gets the current state instead, which is
 * the right answer for a first subscribe and for a device that has been away
 * long enough that the delta is bigger than the state.
 */

import { logger } from '../config/logger.js';
import { AppError } from '../errors/AppError.js';
import * as queueService from '../services/queue.service.js';

import { forgetSocket, sessionOf } from './auth.js';
import { ROOMS, ambientRoomsFor, canJoinSession } from './rooms.js';

import type { Principal } from '../types/express.js';
import type { Server, Socket } from 'socket.io';

/** What a client sends to join a session's room. */
interface SubscribeMessage {
  readonly sessionId?: unknown;
  /** The highest sequence number this client has already folded (`SY-01`). */
  readonly lastSeq?: unknown;
}

/**
 * How far behind a client may be and still get a delta.
 *
 * `SY-06` forces a device offline longer than 24 hours to a full re-pull. The
 * same logic applies to a socket: past some gap, replaying events costs more
 * than sending the state, and the state is what the client wants anyway.
 */
const MAX_DELTA_EVENTS = 500;

export function registerHandlers(io: Server): void {
  io.on('connection', (socket) => {
    const session = sessionOf(socket);
    if (session === undefined) {
      // The handshake middleware refuses unauthenticated sockets, so this is
      // unreachable — and if it ever is reached, the socket is not one to
      // serve.
      socket.disconnect(true);
      return;
    }

    // Rooms a principal is entitled to without any row lookup: a console's own
    // hospital boards. Joining costs nothing it is not already allowed to read.
    for (const room of ambientRoomsFor(session.principal)) {
      void socket.join(room);
      session.rooms.add(room);
    }

    socket.on('session:subscribe', (message: SubscribeMessage) => {
      void subscribeToSession(socket, message).catch((error: unknown) => {
        emitError(socket, error);
      });
    });

    socket.on('session:unsubscribe', (message: SubscribeMessage) => {
      const sessionId = readSessionId(message);
      if (sessionId === null) return;
      const room = ROOMS.session(sessionId);
      void socket.leave(room);
      session.rooms.delete(room);
    });

    socket.on('disconnect', (reason) => {
      logger.debug({ socketId: socket.id, reason }, 'socket disconnected');
      forgetSocket(socket);
    });
  });
}

/**
 * Joins a session room and catches the client up.
 *
 * Authorisation happens here rather than at connection time because it depends
 * on rows: whether this principal holds a booking in this session, and which
 * hospital is running it.
 */
async function subscribeToSession(socket: Socket, message: SubscribeMessage): Promise<void> {
  const session = sessionOf(socket);
  if (session === undefined) {
    socket.disconnect(true);
    return;
  }

  const sessionId = readSessionId(message);
  if (sessionId === null) {
    emitError(socket, new AppError('VALIDATION_FAILED', { details: { field: 'sessionId' } }));
    return;
  }

  const record = await queueService.requireSession(sessionId);
  const allowed = canJoinSession(session.principal, {
    hospitalId: record.hospitalId,
    holdsBooking: await holdsBooking(session.principal, sessionId),
  });

  if (!allowed) {
    emitError(socket, new AppError('AUTH_FORBIDDEN_SCOPE', { details: { room: 'session' } }));
    return;
  }

  const room = ROOMS.session(sessionId);
  await socket.join(room);
  session.rooms.add(room);

  const lastSeq = readLastSeq(message);
  const state = await queueService.getState(sessionId);
  const etas = await queueService.getEtas(sessionId);
  const serverTs = new Date().toISOString();

  // Far enough behind, or never subscribed: send the state rather than a
  // delta. A client that has to fold five hundred events to learn it is
  // number eighteen is a client on a cheap phone locking up (`SY-06`).
  if (lastSeq === null || state.lastSeq - lastSeq > MAX_DELTA_EVENTS) {
    socket.emit('queue.updated', {
      type: 'queue.updated',
      seq: state.lastSeq,
      serverTs,
      data: { state, etas },
    });
    return;
  }

  // Replay what they missed, in order, before any live event reaches them.
  const missed = await queueService.eventsSince(sessionId, lastSeq);
  for (const event of missed) {
    socket.emit('queue.event', {
      type: event.type,
      seq: event.seq,
      serverTs: event.serverTs,
      data: event,
    });
  }

  // Then the settled state, so a client that failed to fold something still
  // converges (`FR-QUE-05`).
  socket.emit('queue.updated', {
    type: 'queue.updated',
    seq: state.lastSeq,
    serverTs,
    data: { state, etas },
  });
}

/** Whether this principal holds a booking in the session. */
async function holdsBooking(principal: Principal, sessionId: string): Promise<boolean> {
  if (principal.kind === 'staff') return false;

  // A tracking link names exactly one booking (`FR-GST-05`); an account holder
  // may have any of theirs in this session.
  return await queueService.principalHoldsBooking(sessionId, {
    userId: principal.kind === 'patient' ? principal.id : null,
    guestId: principal.kind === 'guest' ? principal.id : null,
    bookingId: principal.kind === 'guest' ? principal.bookingId : null,
  });
}

function readSessionId(message: SubscribeMessage): string | null {
  const value = message.sessionId;
  return typeof value === 'string' && value !== '' ? value : null;
}

function readLastSeq(message: SubscribeMessage): number | null {
  const value = message.lastSeq;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Sends a failure to one socket.
 *
 * The same stable code the HTTP layer uses, so a client maps it to the same
 * Bangla copy (BACKEND.md §9) rather than having a second vocabulary for
 * realtime failures.
 */
function emitError(socket: Socket, thrown: unknown): void {
  const error = thrown instanceof AppError ? thrown : new AppError('INTERNAL', { cause: thrown });
  if (!(thrown instanceof AppError)) {
    logger.error({ err: thrown, socketId: socket.id }, 'socket handler failed');
  }
  socket.emit('error.occurred', {
    type: 'error.occurred',
    serverTs: new Date().toISOString(),
    data: error.toBody().error,
  });
}
