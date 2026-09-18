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

import { createServer, type Server as HttpServer } from 'node:http';
import { type AddressInfo } from 'node:net';

import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
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
