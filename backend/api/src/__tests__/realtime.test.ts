/**
 * The socket path, over a real server and a real client (BACKEND.md §6).
 *
 * Every other test in this suite asserts on the recording emitter, which is
 * right for "did the service publish" and says nothing about whether a browser
 * would receive it. This file is the one that binds a port, connects a client,
 * and proves the thing `NFR-01` actually promises: reception taps next, and a
 * subscribed device is told.
 *
 * It also covers the handshake, because a socket is not a lesser door than a
 * request — an unauthenticated connection and a patient listening to somebody
 * else's queue are both refused here.
 */

import { randomUUID } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import { type AddressInfo } from 'node:net';

import { sql } from 'kysely';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';
import { resetEmitter } from '../realtime/emit.js';
import { attachRealtime } from '../realtime/server.js';
import * as queueService from '../services/queue.service.js';

import { createQueueFixture, type QueueFixture } from './support/queueFixture.js';

import type { Server as SocketServer } from 'socket.io';

let httpServer: HttpServer;
let io: SocketServer;
let url: string;
let fixture: QueueFixture;
const clients: ClientSocket[] = [];

/** Opens a client. The caller waits for `connect` or for `connect_error`. */
function open(token: string | null): ClientSocket {
  const socket = connect(url, {
    auth: token === null ? {} : { token },
    transports: ['websocket'],
    reconnection: false,
  });
  clients.push(socket);
  return socket;
}

/** Resolves with the first `event` the socket receives, or rejects on timeout. */
async function once<T>(socket: ClientSocket, event: string, timeoutMs = 4000): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for "${event}"`));
    }, timeoutMs);

    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function staffToken(): Promise<string> {
  return await signToken({
    kind: 'access',
    claims: {
      sub: fixture.receptionistId,
      kind: 'staff',
      hospitalId: fixture.hospitalId,
      roles: ['receptionist'],
    },
  });
}

beforeAll(async () => {
  httpServer = createServer(createApp());
  io = attachRealtime(httpServer);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, resolve);
  });
  const address = httpServer.address() as AddressInfo;
  url = `http://127.0.0.1:${String(address.port)}`;
});

afterAll(async () => {
  await io.close();
  await new Promise<void>((resolve) => {
    httpServer.close(() => {
      resolve();
    });
  });
  // The socket emitter is global; put the recording one back so no other file
  // inherits a closed server.
  resetEmitter();
});

beforeEach(async () => {
  fixture = await createQueueFixture(4);
});

afterEach(() => {
  for (const client of clients) client.disconnect();
  clients.length = 0;
});

describe('the handshake', () => {
  it('refuses a connection with no credential', async () => {
    const socket = open(null);
    const error = await once<Error>(socket, 'connect_error');

    expect(error.message).toBe('unauthorised');
    expect(socket.connected).toBe(false);
  });

  it('refuses a forged token', async () => {
    const socket = open('not.a.jwt');
    const error = await once<Error>(socket, 'connect_error');
    expect(error.message).toBe('unauthorised');
  });

  it('admits a staff member of the hospital', async () => {
    const socket = open(await staffToken());
    await once(socket, 'connect');
    expect(socket.connected).toBe(true);
  });
});

describe('session rooms', () => {
  it('sends the state on subscribe', async () => {
    const socket = open(await staffToken());
    await once(socket, 'connect');

    socket.emit('session:subscribe', { sessionId: fixture.sessionId });
    const payload = await once<{ data: { state: { entries: unknown[] } } }>(
      socket,
      'queue.updated',
    );

    expect(payload.data.state.entries).toHaveLength(4);
  });

  it('refuses a session at another hospital (FR-ROLE-01)', async () => {
    const elsewhere = await signToken({
      kind: 'access',
      claims: {
        sub: fixture.receptionistId,
        kind: 'staff',
        hospitalId: '44444444-4444-7444-8444-999999999999',
        roles: ['receptionist'],
      },
    });

    const socket = open(elsewhere);
    await once(socket, 'connect');

    socket.emit('session:subscribe', { sessionId: fixture.sessionId });
    const error = await once<{ data: { code: string } }>(socket, 'error.occurred');

    expect(error.data.code).toBe('AUTH_FORBIDDEN_SCOPE');
  });

  it('refuses a patient with no booking in the session', async () => {
    const stranger = await signToken({
      kind: 'access',
      claims: { sub: '11111111-1111-7111-8111-111111111111', kind: 'patient' },
    });

    const socket = open(stranger);
    await once(socket, 'connect');

    socket.emit('session:subscribe', { sessionId: fixture.sessionId });
    const error = await once<{ data: { code: string } }>(socket, 'error.occurred');

    expect(error.data.code).toBe('AUTH_FORBIDDEN_SCOPE');
  });

  // Found by the security review of 2026-09-30: a guest was admitted by the
  // identity behind the token, so any token for a number opened every chamber
  // that number was booked into — and told whoever held it which ones.
  describe('a guest is admitted by the booking the token names, never by the number', () => {
    /** A real guest booking in the fixture's chamber, and the identity it was made under. */
    async function guestBooking(): Promise<{ bookingId: string; guestId: string }> {
      const phone = `+88019${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`;
      const response = await request(httpServer)
        .post('/api/v1/bookings')
        .set('Idempotency-Key', crypto.randomUUID())
        .send({
          sessionId: fixture.sessionId,
          method: 'at_hospital',
          guest: { name: 'রহিমা খাতুন (ডেমো)', phone, ageYears: 34, sex: 'female' },
        });
      expect(response.status).toBe(201);
      const bookingId = response.body.data.bookingId as string;
      const row = await sql<{ booked_by_guest_id: string }>`
        SELECT booked_by_guest_id FROM bookings WHERE id = ${bookingId}::uuid
      `.execute(db);
      return { bookingId, guestId: row.rows[0]?.booked_by_guest_id ?? '' };
    }

    async function subscribeWith(token: string): Promise<string> {
      const socket = open(token);
      await once(socket, 'connect');
      socket.emit('session:subscribe', { sessionId: fixture.sessionId });
      return await Promise.race([
        once(socket, 'queue.updated').then(() => 'admitted'),
        once<{ data: { code: string } }>(socket, 'error.occurred').then((error) => error.data.code),
      ]);
    }

    it('refuses a token that names no booking, though its number holds one here', async () => {
      const { guestId } = await guestBooking();
      const bookingFlow = await signToken({
        kind: 'access',
        claims: { sub: guestId, kind: 'guest' },
      });

      expect(await subscribeWith(bookingFlow)).toBe('AUTH_FORBIDDEN_SCOPE');
    });

    it('refuses a link for a booking elsewhere, though its number holds one here', async () => {
      const { guestId } = await guestBooking();
      const elsewhere = await signToken({
        kind: 'access',
        claims: { sub: guestId, kind: 'guest', bookingId: crypto.randomUUID() },
      });

      expect(await subscribeWith(elsewhere)).toBe('AUTH_FORBIDDEN_SCOPE');
    });

    it('admits the link for the booking in this chamber', async () => {
      const { bookingId, guestId } = await guestBooking();
      const link = await signToken({
        kind: 'access',
        claims: { sub: guestId, kind: 'guest', bookingId },
      });

      expect(await subscribeWith(link)).toBe('admitted');
    });
  });
});

describe('the broadcast the product is built on (NFR-01)', () => {
  it('reaches a subscribed device when reception calls the next patient', async () => {
    const socket = open(await staffToken());
    await once(socket, 'connect');

    socket.emit('session:subscribe', { sessionId: fixture.sessionId });
    await once(socket, 'queue.updated');

    const actor = {
      kind: 'staff' as const,
      staffUserId: fixture.receptionistId as never,
      role: 'receptionist' as const,
    };

    // The listener is registered *before* the tap. Attaching it afterwards is
    // a race the broadcast usually wins, which would make this test flaky in
    // the direction that hides a real failure.
    const update$ = once<{ data: { state: { status: string } }; seq: number }>(
      socket,
      'queue.updated',
    );

    const startedAt = Date.now();
    await queueService.appendEvent({
      sessionId: fixture.sessionId,
      type: 'DOCTOR_ARRIVED',
      payload: { arrivedAt: new Date().toISOString(), minutesLate: 0 },
      actor,
    });

    const update = await update$;
    const elapsed = Date.now() - startedAt;

    expect(update.data.state.status).toBe('running');
    expect(update.seq).toBeGreaterThan(0);
    // NFR-01 allows two seconds end to end over a real network. On a loopback
    // it is milliseconds; asserting the budget here catches a regression that
    // makes the path synchronous or adds a round trip.
    expect(elapsed).toBeLessThan(2000);
  });

  it('replays what a reconnecting client missed (SY-01)', async () => {
    const actor = {
      kind: 'staff' as const,
      staffUserId: fixture.receptionistId as never,
      role: 'receptionist' as const,
    };

    // Two events happen while nobody is listening.
    const first = await queueService.appendEvent({
      sessionId: fixture.sessionId,
      type: 'DOCTOR_ARRIVED',
      payload: { arrivedAt: new Date().toISOString(), minutesLate: 0 },
      actor,
    });
    await queueService.callNext({ sessionId: fixture.sessionId, actor });

    // A device that had folded up to the first one reconnects.
    const socket = open(await staffToken());
    await once(socket, 'connect');

    const replayed: number[] = [];
    socket.on('queue.event', (payload: { seq: number }) => {
      replayed.push(payload.seq);
    });

    socket.emit('session:subscribe', { sessionId: fixture.sessionId, lastSeq: first.seq });
    await once(socket, 'queue.updated');

    // Everything after the sequence it reported, and nothing it already had.
    expect(replayed.length).toBeGreaterThan(0);
    for (const seq of replayed) expect(seq).toBeGreaterThan(first.seq);
  });
});

describe('a statement of the queue names the actions it took in (SY-08)', () => {
  const actor = (): Parameters<typeof queueService.appendBatch>[0]['actor'] => ({
    kind: 'staff' as const,
    staffUserId: fixture.receptionistId as never,
    role: 'receptionist' as const,
  });

  interface Named {
    readonly seq: number;
    readonly applied: readonly { clientEventId: string; seq: number; eventId: string }[];
  }

  it('a broadcast names the actions of the write behind it, and nothing older', async () => {
    const socket = open(await staffToken());
    await once(socket, 'connect');
    socket.emit('session:subscribe', { sessionId: fixture.sessionId });
    // The catch-up for a console waiting on nothing names nothing.
    expect((await once<Named>(socket, 'queue.updated')).applied).toEqual([]);

    const arrived = randomUUID();
    const first$ = once<Named>(socket, 'queue.updated');
    const batch = await queueService.appendBatch({
      sessionId: fixture.sessionId,
      actor: actor(),
      entries: [
        {
          clientEventId: arrived,
          type: 'DOCTOR_ARRIVED',
          payload: { arrivedAt: new Date().toISOString(), minutesLate: 0 },
          clientTs: new Date().toISOString(),
        },
      ],
    });
    const first = await first$;
    const accepted = batch.outcomes[0];
    if (accepted?.kind !== 'accepted') throw new Error('the batch was refused');
    // By the console's own key, with what the log made of it: the same thing
    // the answer says, by the other road.
    expect(first.applied).toEqual([
      { clientEventId: arrived, seq: accepted.seq, eventId: accepted.eventId },
    ]);
    expect(first.seq).toBe(accepted.seq);

    // The next write names its own action only.
    const delayed = randomUUID();
    const second$ = once<Named>(socket, 'queue.updated');
    await queueService.appendBatch({
      sessionId: fixture.sessionId,
      actor: actor(),
      entries: [
        {
          clientEventId: delayed,
          type: 'DELAY_DECLARED',
          payload: { minutes: 30, reason: null, declaredBy: 'reception' },
          clientTs: new Date().toISOString(),
        },
      ],
    });
    const second = await second$;
    expect(second.applied.map((entry) => entry.clientEventId)).toEqual([delayed]);
    expect(second.seq).toBeGreaterThan(first.seq);
  });

  it('a catch-up names the unanswered actions the log holds, and only those', async () => {
    const taken = randomUUID();
    const batch = await queueService.appendBatch({
      sessionId: fixture.sessionId,
      actor: actor(),
      entries: [
        {
          clientEventId: taken,
          type: 'DOCTOR_ARRIVED',
          payload: { arrivedAt: new Date().toISOString(), minutesLate: 0 },
          clientTs: new Date().toISOString(),
        },
      ],
    });
    const accepted = batch.outcomes[0];
    if (accepted?.kind !== 'accepted') throw new Error('the batch was refused');

    // A console reconnects still waiting on two actions: the one above, whose
    // answer it never got, and one that never reached the server.
    const neverSent = randomUUID();
    const socket = open(await staffToken());
    await once(socket, 'connect');
    socket.emit('session:subscribe', {
      sessionId: fixture.sessionId,
      unanswered: [taken, neverSent, 'not-a-key', 42],
    });
    const caughtUp = await once<Named>(socket, 'queue.updated');
    expect(caughtUp.applied).toEqual([
      { clientEventId: taken, seq: accepted.seq, eventId: accepted.eventId },
    ]);
    // Named beside a queue that contains it.
    expect(caughtUp.seq).toBeGreaterThanOrEqual(accepted.seq);
  });

  it('does not name another chamber’s action, whatever key is asked about', async () => {
    const elsewhere = await createQueueFixture(2);
    const key = randomUUID();
    await queueService.appendBatch({
      sessionId: elsewhere.sessionId,
      actor: {
        kind: 'staff' as const,
        staffUserId: elsewhere.receptionistId as never,
        role: 'receptionist' as const,
      },
      entries: [
        {
          clientEventId: key,
          type: 'DOCTOR_ARRIVED',
          payload: { arrivedAt: new Date().toISOString(), minutesLate: 0 },
          clientTs: new Date().toISOString(),
        },
      ],
    });

    const socket = open(await staffToken());
    await once(socket, 'connect');
    socket.emit('session:subscribe', { sessionId: fixture.sessionId, unanswered: [key] });
    expect((await once<Named>(socket, 'queue.updated')).applied).toEqual([]);
  });
});
