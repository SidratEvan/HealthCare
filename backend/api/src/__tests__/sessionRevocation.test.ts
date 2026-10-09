/**
 * Access that has been ended stops working at once (plan A6; `FR-SEC-06`,
 * `FR-ROLE-01`; handover finding 17).
 *
 * A staff access token used to be honoured for its whole fifteen minutes
 * whatever had happened since it was issued, and a console's live connection,
 * once made, stayed made: a receptionist deactivated by her administrator
 * went on working, and went on being sent the queue.
 *
 * The accounts here are made for the test and signed in through the real
 * door, because what is under test is the token a sign-in issues.
 */

import { randomUUID } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import { type AddressInfo } from 'node:net';

import { sql } from 'kysely';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken, verifyToken } from '../config/jwt.js';
import { hashPassword } from '../config/password.js';
import { sweepRevoked } from '../realtime/auth.js';
import { resetEmitter } from '../realtime/emit.js';
import { attachRealtime } from '../realtime/server.js';

import { asOwner } from './support/ownerDb.js';
import { bearer } from './support/tokens.js';

import type { Express } from 'express';
import type { Server as SocketServer } from 'socket.io';

const BASE = '/api/v1';
const PASSWORD = 'correct-horse-battery';

let app: Express;
let httpServer: HttpServer;
let io: SocketServer;
let url: string;
let hospitalId: string;
const made: string[] = [];
const clients: ClientSocket[] = [];

interface SignedIn {
  readonly staffId: string;
  readonly email: string;
  readonly access: string;
  readonly refresh: string;
}

async function makeStaff(roles: readonly string[] = ['receptionist']): Promise<{
  id: string;
  email: string;
}> {
  const email = `rev-${randomUUID().slice(0, 8)}@shapla.demo.invalid`;
  const inserted = await sql<{ id: string }>`
    INSERT INTO staff_users (hospital_id, email, full_name, password_hash, must_change_password, is_active)
    VALUES (${hospitalId}, ${email}, 'পরীক্ষা (ডেমো)', ${await hashPassword(PASSWORD)}, false, true)
    RETURNING id
  `.execute(db);
  const id = inserted.rows[0]?.id ?? '';
  for (const role of roles) {
    await sql`
      INSERT INTO staff_roles (staff_user_id, hospital_id, role)
      VALUES (${id}, ${hospitalId}, ${role}::staff_role)
    `.execute(db);
  }
  made.push(id);
  return { id, email };
}

async function signIn(email: string): Promise<{ access: string; refresh: string }> {
  const response = await request(app)
    .post(`${BASE}/staff/login`)
    .send({ email, password: PASSWORD });
  expect(response.status).toBe(200);
  return {
    access: response.body.data.access as string,
    refresh: response.body.data.refresh as string,
  };
}

async function signedIn(): Promise<SignedIn> {
  const staff = await makeStaff();
  return { staffId: staff.id, email: staff.email, ...(await signIn(staff.email)) };
}

/** A request any signed-in member of staff may make. */
async function me(access: string): Promise<request.Response> {
  return await request(app).get(`${BASE}/staff/me`).set('Authorization', bearer(access));
}

function open(token: string): ClientSocket {
  const socket = connect(url, { auth: { token }, transports: ['websocket'], reconnection: false });
  clients.push(socket);
  return socket;
}

async function once(socket: ClientSocket, event: string, timeoutMs = 4_000): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for "${event}"`));
    }, timeoutMs);
    socket.once(event, (payload: unknown) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

beforeAll(async () => {
  app = createApp();
  httpServer = createServer(app);
  io = attachRealtime(httpServer);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, resolve);
  });
  url = `http://127.0.0.1:${String((httpServer.address() as AddressInfo).port)}`;

  const shapla = await sql<{ id: string }>`SELECT id FROM hospitals WHERE code = 'SHAPLA'`.execute(
    db,
  );
  hospitalId = shapla.rows[0]?.id ?? '';
  if (hospitalId === '') throw new Error('No seeded facility with code SHAPLA (FR-DEM-01).');
});

afterEach(() => {
  for (const client of clients) client.disconnect();
  clients.length = 0;
});

afterAll(async () => {
  await io.close();
  await new Promise<void>((resolve) => {
    httpServer.close(() => {
      resolve();
    });
  });
  resetEmitter();

  // As the owner: the API's own role may not delete an audit row.
  await asOwner(async (owner) => {
    await sql`DELETE FROM audit_log WHERE actor_staff_id = ANY(${made}::uuid[])`.execute(owner);
    await sql`DELETE FROM sessions_auth WHERE subject_id = ANY(${made}::uuid[])`.execute(owner);
    await sql`DELETE FROM staff_roles WHERE staff_user_id = ANY(${made}::uuid[])`.execute(owner);
    await sql`DELETE FROM staff_users WHERE id = ANY(${made}::uuid[])`.execute(owner);
  });
});

describe('a token names the sign-in it came from', () => {
  it('carries the sign-in, and keeps it when the tokens are renewed', async () => {
    const session = await signedIn();
    const first = await verifyToken(session.access, 'access');
    if (!first.ok) throw new Error('the access token did not verify');
    expect(typeof first.claims.sid).toBe('string');

    const renewed = await request(app)
      .post(`${BASE}/staff/refresh`)
      .send({ refresh: session.refresh });
    expect(renewed.status).toBe(200);
    const second = await verifyToken(renewed.body.data.access as string, 'access');
    if (!second.ok) throw new Error('the renewed token did not verify');
    // One sign-in, across the rotation.
    expect(second.claims.sid).toBe(first.claims.sid);

    // And the access token from before the renewal is still the same
    // sign-in's: it works until it expires, as it always did.
    expect((await me(session.access)).status).toBe(200);
  });

  it('gives a second sign-in by the same person its own', async () => {
    const staff = await makeStaff();
    const desk = await verifyToken((await signIn(staff.email)).access, 'access');
    const tablet = await verifyToken((await signIn(staff.email)).access, 'access');
    if (!desk.ok || !tablet.ok) throw new Error('a token did not verify');
    expect(desk.claims.sid).not.toBe(tablet.claims.sid);
  });
});

describe('signing out ends that sign-in at once (FR-SEC-06)', () => {
  it('refuses the access token from the very next request, though it has not expired', async () => {
    const session = await signedIn();
    expect((await me(session.access)).status).toBe(200);

    await request(app).post(`${BASE}/staff/logout`).send({ refresh: session.refresh });

    const after = await me(session.access);
    expect(after.status).toBe(401);
    expect(after.body.error).toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
      details: { reason: 'revoked' },
    });
  });

  it('leaves the person’s other device signed in', async () => {
    const staff = await makeStaff();
    const desk = await signIn(staff.email);
    const tablet = await signIn(staff.email);

    await request(app).post(`${BASE}/staff/logout`).send({ refresh: desk.refresh });

    expect((await me(desk.access)).status).toBe(401);
    expect((await me(tablet.access)).status).toBe(200);
  });

  it('closes that sign-in’s live connection, and not the other device’s', async () => {
    const staff = await makeStaff();
    const desk = await signIn(staff.email);
    const tablet = await signIn(staff.email);
    const deskSocket = open(desk.access);
    const tabletSocket = open(tablet.access);
    await Promise.all([once(deskSocket, 'connect'), once(tabletSocket, 'connect')]);

    const closed = once(deskSocket, 'disconnect');
    await request(app).post(`${BASE}/staff/logout`).send({ refresh: desk.refresh });

    // By the server, which is why the console does not simply reconnect.
    expect(await closed).toBe('io server disconnect');
    expect(tabletSocket.connected).toBe(true);
  });

  it('does not let the revoked token connect again', async () => {
    const session = await signedIn();
    await request(app).post(`${BASE}/staff/logout`).send({ refresh: session.refresh });

    const socket = open(session.access);
    const refused = (await once(socket, 'connect_error')) as Error;
    expect(refused.message).toBe('unauthorised');
  });
});

describe('deactivating an account ends everything it had open, at once (FR-SEC-06, FR-ROLE-01)', () => {
  async function deactivate(staffId: string): Promise<void> {
    const admin = await makeStaff(['hospital_admin']);
    // An administrator signed in through the real door would be asked for a
    // second factor first; what is under test is the receptionist's access.
    const adminToken = await signToken({
      kind: 'access',
      claims: { sub: admin.id, kind: 'staff', hospitalId, roles: ['hospital_admin'] },
    });
    const response = await request(app)
      .patch(`${BASE}/hospital/staff/${staffId}`)
      .set('Authorization', bearer(adminToken))
      .set('Idempotency-Key', randomUUID())
      .send({ isActive: false });
    expect(response.status).toBe(200);
  }

  it('refuses her token from the next request, and closes her screen’s connection', async () => {
    const session = await signedIn();
    const socket = open(session.access);
    await once(socket, 'connect');
    expect((await me(session.access)).status).toBe(200);

    const closed = once(socket, 'disconnect');
    await deactivate(session.staffId);

    expect(await closed).toBe('io server disconnect');
    expect((await me(session.access)).status).toBe(401);
    // Renewing does not bring it back.
    expect(
      (await request(app).post(`${BASE}/staff/refresh`).send({ refresh: session.refresh })).status,
    ).toBe(401);
  });

  it('refuses a token that names no sign-in too, once its account is inactive', async () => {
    // What the demonstration's password-less door mints: no `sid`.
    const staff = await makeStaff();
    const token = await signToken({
      kind: 'access',
      claims: { sub: staff.id, kind: 'staff', hospitalId, roles: ['receptionist'] },
    });
    expect((await me(token)).status).toBe(200);

    await deactivate(staff.id);
    expect((await me(token)).status).toBe(401);
  });
});

describe('access ended by a road this process did not see', () => {
  it('is refused at the next request, and its connection is closed by the sweep', async () => {
    const session = await signedIn();
    const socket = open(session.access);
    await once(socket, 'connect');

    // A command on the server, a row changed by hand: nothing in this
    // process is told.
    await sql`
      UPDATE sessions_auth SET revoked_at = now() WHERE subject_id = ${session.staffId}
    `.execute(db);

    expect((await me(session.access)).status).toBe(401);

    const closed = once(socket, 'disconnect');
    expect(await sweepRevoked()).toBe(1);
    expect(await closed).toBe('io server disconnect');
  });

  it('the sweep leaves a connection whose access still stands', async () => {
    const session = await signedIn();
    const socket = open(session.access);
    await once(socket, 'connect');

    await sweepRevoked();
    expect(socket.connected).toBe(true);
  });
});

describe('what is deliberately let through', () => {
  it('honours a token whose subject is no account at all: nothing was revoked', async () => {
    const token = await signToken({
      kind: 'access',
      claims: { sub: randomUUID(), kind: 'staff', hospitalId, roles: ['receptionist'] },
    });
    // Not `/staff/me`, which looks the account up; a route that needs only
    // the role and the hospital the token states.
    const response = await request(app)
      .get(`${BASE}/hospitals/${hospitalId}/beds`)
      .set('Authorization', bearer(token));
    expect(response.status).toBe(200);
  });

  it('does not ask about a patient or a guest: only staff access is revocable here', async () => {
    const token = await signToken({
      kind: 'access',
      claims: { sub: randomUUID(), kind: 'patient' },
    });
    const socket = open(token);
    await once(socket, 'connect');
    expect(socket.connected).toBe(true);
  });
});
