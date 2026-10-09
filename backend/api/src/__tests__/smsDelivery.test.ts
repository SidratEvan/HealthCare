/**
 * An SMS aggregator over HTTPS, and its delivery receipts (`PRD.md`
 * `FR-NOT-06`; `BACKEND.md` §7.7 `/webhooks/sms-dlr`; migration 0054; plan
 * H2).
 *
 * No aggregator account exists (`CLAUDE.md` §1.1), so the one here is a
 * stand-in: a small HTTP server in this process that takes a message as
 * `adapters/smsHttp.ts` sends it, answers as it is told to, and signs
 * receipts with a secret. Against it, what has to hold whichever aggregator
 * it turns out to be:
 *
 * - a message goes out with the key and the sender, and comes back with a
 *   reference; a refusal says whether asking again could help;
 * - a receipt is believed only with a valid signature over the bytes as sent,
 *   and with the demonstration's provider, which sends none, never;
 * - a receipt marks the one message it names, once, however often it is sent;
 * - a hospital's administrator reads the month's messages by what became of
 *   them, and is not shown "none delivered" by a provider that reports none.
 *
 * Runs against the seeded demo database (CLAUDE.md §6), on a chamber of its own.
 */

import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { StaffRole } from '@platform/domain';

import { resetSmsAdapter, setSmsAdapter } from '../adapters/sms.js';
import { HttpSmsAdapter, httpReceiptSignature, type HttpSmsConfig } from '../adapters/smsHttp.js';
import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { resetEmitter } from '../realtime/emit.js';
import * as notifications from '../services/notification.service.js';
import * as queueService from '../services/queue.service.js';

import { createQueueFixture, type QueueFixture } from './support/queueFixture.js';
import { bearer, staffToken } from './support/tokens.js';

import type { Express } from 'express';
import type { AddressInfo } from 'node:net';

const BASE = '/api/v1';
const SECRET = 'test-only-receipt-secret-not-a-real-credential';

// --- the stand-in aggregator ---------------------------------------------------

interface Taken {
  readonly authorization: string | undefined;
  readonly body: Record<string, unknown>;
}

let aggregator: Server;
let aggregatorUrl: string;
/** What it was sent, oldest first. */
let taken: Taken[] = [];
/** How it answers the next messages: a status, and whether it answers at all. */
let answer: { status: number; hang: boolean } = { status: 200, hang: false };

function respond(req: IncomingMessage, res: ServerResponse): void {
  let raw = '';
  req.on('data', (chunk: Buffer) => {
    raw += chunk.toString('utf8');
  });
  req.on('end', () => {
    taken.push({
      authorization: req.headers.authorization,
      body: JSON.parse(raw) as Record<string, unknown>,
    });
    if (answer.hang) return;
    res.writeHead(answer.status, { 'content-type': 'application/json' });
    res.end(
      answer.status === 200
        ? JSON.stringify({ id: `agg-${String(taken.length)}-${randomUUID().slice(0, 8)}` })
        : JSON.stringify({ error: 'refused' }),
    );
  });
}

function configured(overrides: Partial<HttpSmsConfig> = {}): HttpSmsAdapter {
  return new HttpSmsAdapter({
    url: aggregatorUrl,
    apiKey: 'test-only-api-key',
    senderId: 'MedLiveBD',
    receiptSecret: SECRET,
    timeoutMs: 2_000,
    ...overrides,
  });
}

// --- the chamber -----------------------------------------------------------------

let app: Express;
let fixture: QueueFixture;

function staff(roles: readonly StaffRole[] = ['receptionist']) {
  return {
    kind: 'staff' as const,
    staffUserId: fixture.receptionistId as never,
    role: roles[0] ?? 'receptionist',
  };
}

interface Row {
  readonly id: string;
  readonly state: string;
  readonly error: string | null;
  readonly providerRef: string | null;
  readonly deliveredAfterSent: boolean | null;
}

async function rows(): Promise<Row[]> {
  const result = await sql<{
    id: string;
    state: string;
    error: string | null;
    provider_ref: string | null;
    in_order: boolean | null;
  }>`
    SELECT n.id, n.state::text AS state, n.error, n.provider_ref,
           (n.delivered_at >= n.sent_at) AS in_order
      FROM notifications n
     WHERE n.template_key = 'queue.delayed' AND n.channel = 'sms'
       AND (n.params ->> 'bookingId')::uuid IN (
             SELECT id FROM bookings WHERE session_id = ${fixture.sessionId}::uuid)
     ORDER BY n.queued_at, n.id
  `.execute(db);
  return result.rows.map((row) => ({
    id: row.id,
    state: row.state,
    error: row.error,
    providerRef: row.provider_ref,
    deliveredAfterSent: row.in_order,
  }));
}

/** A queue action whose messages go to the stand-in aggregator and are taken. */
async function sendSome(): Promise<Row[]> {
  await queueService.appendEvent({
    sessionId: fixture.sessionId,
    type: 'DELAY_DECLARED',
    payload: { minutes: 30, reason: null, declaredBy: 'reception' },
    actor: staff(),
  });
  await notifications.settled();
  return await rows();
}

/** A receipt as the aggregator sends it: its body, signed over the bytes as sent. */
async function receipt(
  body: Record<string, unknown> | string,
  signature?: string | null,
): Promise<request.Response> {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const pending = request(app)
    .post(`${BASE}/webhooks/sms-dlr`)
    .set('content-type', 'application/json');
  const signed =
    signature === null
      ? pending
      : pending.set('x-signature', signature ?? httpReceiptSignature(raw, SECRET));
  return await signed.send(raw);
}

beforeAll(async () => {
  app = createApp();
  aggregator = createServer(respond);
  await new Promise<void>((resolve) => {
    aggregator.listen(0, '127.0.0.1', resolve);
  });
  const { port } = aggregator.address() as AddressInfo;
  aggregatorUrl = `http://127.0.0.1:${String(port)}/messages`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    aggregator.closeAllConnections();
    aggregator.close(() => {
      resolve();
    });
  });
});

beforeEach(async () => {
  resetEmitter();
  notifications.forgetTemplates();
  taken = [];
  answer = { status: 200, hang: false };
  setSmsAdapter(configured());
  fixture = await createQueueFixture(3);
  await sql`
    UPDATE patients SET phone = '+8801712345678'
     WHERE id IN (SELECT patient_id FROM bookings WHERE session_id = ${fixture.sessionId}::uuid)
  `.execute(db);
  await sql`
    UPDATE hospital_settings SET sms_budget_monthly = NULL
     WHERE hospital_id = ${fixture.hospitalId}::uuid
  `.execute(db);
});

afterEach(() => {
  resetSmsAdapter();
});

describe('a message leaves through the aggregator (SMS_PROVIDER=http)', () => {
  it('carries the key, the sender, the number and the words, and comes back with a reference', async () => {
    const sent = await sendSome();
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((row) => row.state === 'sent')).toBe(true);
    expect(sent.every((row) => row.providerRef?.startsWith('agg-') === true)).toBe(true);

    expect(taken).toHaveLength(sent.length);
    for (const message of taken) {
      expect(message.authorization).toBe('Bearer test-only-api-key');
      expect(message.body['senderId']).toBe('MedLiveBD');
      expect(message.body['to']).toBe('+8801712345678');
      expect(String(message.body['text'])).toContain('৩০');
      // Ours, so an answer and a receipt can be matched to the row.
      expect(sent.map((row) => row.id)).toContain(message.body['reference']);
    }
  });

  it('a server error is worth asking again: the message stays queued', async () => {
    answer = { status: 503, hang: false };
    for (const row of await sendSome()) {
      expect(row).toMatchObject({ state: 'queued', error: 'gateway_http_503' });
    }
  });

  it('being told to slow down is worth asking again', async () => {
    answer = { status: 429, hang: false };
    for (const row of await sendSome()) {
      expect(row).toMatchObject({ state: 'queued', error: 'gateway_http_429' });
    }
  });

  it('a refusal of the request itself is not: the message fails at once', async () => {
    answer = { status: 400, hang: false };
    for (const row of await sendSome()) {
      expect(row).toMatchObject({ state: 'failed', error: 'gateway_http_400' });
    }
  });

  it('an aggregator that does not answer is given up on for this try, and asked again', async () => {
    setSmsAdapter(configured({ timeoutMs: 150 }));
    answer = { status: 200, hang: true };
    for (const row of await sendSome()) {
      expect(row).toMatchObject({ state: 'queued', error: 'gateway_timeout' });
    }
  });

  it('one that cannot be reached at all is asked again', async () => {
    setSmsAdapter(configured({ url: 'http://127.0.0.1:9/messages' }));
    for (const row of await sendSome()) {
      expect(row.state).toBe('queued');
      expect(['gateway_unreachable', 'gateway_timeout']).toContain(row.error);
    }
  });
});

describe('a delivery receipt is believed only when signed (FR-NOT-06)', () => {
  it('refuses one with no signature, a wrong one, or one made for other bytes', async () => {
    const [sent] = await sendSome();
    const body = { id: sent?.providerRef, status: 'DELIVERED' };

    expect((await receipt(body, null)).status).toBe(401);
    expect((await receipt(body, 'not-a-signature')).status).toBe(401);
    expect(
      (await receipt(body, httpReceiptSignature(JSON.stringify(body), 'another-secret'))).status,
    ).toBe(401);
    // Signed, and then the body changed on the way.
    const signature = httpReceiptSignature(JSON.stringify(body), SECRET);
    expect((await receipt({ ...body, status: 'FAILED' }, signature)).status).toBe(401);

    expect((await rows())[0]?.state).toBe('sent');
  });

  it('refuses every receipt where the adapter was given no secret', async () => {
    const [sent] = await sendSome();
    setSmsAdapter(configured({ receiptSecret: '' }));
    const body = { id: sent?.providerRef, status: 'DELIVERED' };
    expect((await receipt(body, httpReceiptSignature(JSON.stringify(body), ''))).status).toBe(401);
    expect((await rows())[0]?.state).toBe('sent');
  });

  it('refuses every receipt with the demonstration’s provider, which sends none', async () => {
    const [sent] = await sendSome();
    resetSmsAdapter();
    expect((await receipt({ id: sent?.providerRef, status: 'DELIVERED' })).status).toBe(401);
    expect((await rows())[0]?.state).toBe('sent');
  });
});

describe('what a receipt records', () => {
  it('delivered: the one message it names, and no other', async () => {
    const sent = await sendSome();
    const [first, second] = sent;

    const response = await receipt({ id: first?.providerRef, status: 'DELIVRD' });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ applied: true });

    const after = await rows();
    expect(after.find((row) => row.id === first?.id)).toMatchObject({
      state: 'delivered',
      deliveredAfterSent: true,
    });
    expect(after.find((row) => row.id === second?.id)?.state).toBe('sent');
  });

  it('the same receipt again is one fact, and still answered 200', async () => {
    const [first] = await sendSome();
    const body = { id: first?.providerRef, status: 'delivered' };
    expect((await receipt(body)).body.data).toEqual({ applied: true });

    const again = await receipt(body);
    expect(again.status).toBe(200);
    expect(again.body.data).toEqual({ applied: false });
  });

  it('undelivered: failed, with the aggregator’s reason, and not asked again', async () => {
    const [first] = await sendSome();
    const before = taken.length;

    const response = await receipt({
      id: first?.providerRef,
      status: 'UNDELIV',
      reason: 'absent subscriber',
    });
    expect(response.body.data).toEqual({ applied: true });
    expect((await rows()).find((row) => row.id === first?.id)).toMatchObject({
      state: 'failed',
      error: 'undelivered:absent subscriber',
    });

    // A second SMS would be a second charge for the same answer.
    await notifications.settled();
    expect(taken).toHaveLength(before);
    // And a late "delivered" for it does not rewrite what was recorded.
    expect((await receipt({ id: first?.providerRef, status: 'delivered' })).body.data).toEqual({
      applied: false,
    });
  });

  it('keeps a short, plain reason whatever the aggregator sent', async () => {
    const [first] = await sendSome();
    await receipt({
      id: first?.providerRef,
      status: 'failed',
      reason: `হ্যান্ডসেট বন্ধ ${'x'.repeat(300)}`,
    });
    const error = (await rows()).find((row) => row.id === first?.id)?.error ?? '';
    expect(error.startsWith('undelivered:')).toBe(true);
    expect(error.length).toBeLessThanOrEqual('undelivered:'.length + 80);
    expect(/^[\x20-\x7E]+$/.test(error)).toBe(true);
  });

  it('a status that is not final is acknowledged and changes nothing', async () => {
    const [first] = await sendSome();
    const response = await receipt({ id: first?.providerRef, status: 'ENROUTE' });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ applied: false });
    expect((await rows()).find((row) => row.id === first?.id)?.state).toBe('sent');
  });

  it('one for a message this system does not know is answered 200 and changes nothing', async () => {
    await sendSome();
    const response = await receipt({ id: `agg-nobody-${randomUUID()}`, status: 'delivered' });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ applied: false });
    expect((await rows()).every((row) => row.state === 'sent')).toBe(true);
  });

  it('a signed body it cannot read is a 400, not a guess', async () => {
    expect((await receipt({ status: 'delivered' })).status).toBe(400);
    expect((await receipt({ id: 'agg-1' })).status).toBe(400);
    expect((await receipt('not json at all')).status).toBe(400);
  });
});

describe('a hospital reads its month of messages (FR-NOT-06)', () => {
  async function month(token: string | null): Promise<request.Response> {
    const pending = request(app).get(`${BASE}/hospital/messages`);
    return await (token === null ? pending : pending.set('Authorization', bearer(token)));
  }

  it('is its administrator’s to read, and nobody else’s', async () => {
    expect((await month(null)).status).toBe(401);
    expect((await month(await staffToken(['receptionist'], fixture.hospitalId))).status).toBe(403);
    expect((await month(await staffToken(['hospital_admin'], fixture.hospitalId))).status).toBe(
      200,
    );
  });

  it('counts what was sent, what a receipt says arrived, and what failed', async () => {
    const admin = await staffToken(['hospital_admin'], fixture.hospitalId);
    const before = (await month(admin)).body.data as Record<string, number>;

    const sent = await sendSome();
    expect(sent.length).toBeGreaterThanOrEqual(3);
    await receipt({ id: sent[0]?.providerRef, status: 'delivered' });
    await receipt({ id: sent[1]?.providerRef, status: 'failed', reason: 'absent subscriber' });

    const response = await month(admin);
    const after = response.body.data as Record<string, number | boolean | string>;
    expect(Object.keys(after).sort()).toEqual([
      'asOf',
      'delivered',
      'failed',
      'held',
      'reportsDelivery',
      'sent',
      'waiting',
    ]);
    // Other suites send for this hospital too, so what is asked is how far
    // each count moved, at least.
    expect(Number(after['sent']) - (before['sent'] ?? 0)).toBeGreaterThanOrEqual(sent.length - 1);
    expect(Number(after['delivered']) - (before['delivered'] ?? 0)).toBeGreaterThanOrEqual(1);
    expect(Number(after['failed']) - (before['failed'] ?? 0)).toBeGreaterThanOrEqual(1);
    // An aggregator that sends receipts: "delivered" is a real count.
    expect(after['reportsDelivery']).toBe(true);
    expect(Date.parse(String(after['asOf']))).toBeGreaterThan(Date.now() - 60_000);
  });

  it('says so where the provider reports no delivery, so that nought is not read as none', async () => {
    resetSmsAdapter();
    const response = await month(await staffToken(['hospital_admin'], fixture.hospitalId));
    expect(response.body.data.reportsDelivery).toBe(false);
  });

  it('carries no message’s words and nobody’s number', async () => {
    await sendSome();
    const text = JSON.stringify(
      (await month(await staffToken(['hospital_admin'], fixture.hospitalId))).body,
    );
    expect(text).not.toContain('+8801712345678');
    expect(text).not.toContain('৩০');
  });
});
