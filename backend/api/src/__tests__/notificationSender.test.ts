/**
 * The notification sender (`PRD.md` `FR-NOT-06`, `FR-NOT-07`; `BACKEND.md` §8;
 * migration 0053; plan H1).
 *
 * Sending used to happen inside the request that caused the message. What
 * this holds the sender to, now that it does not:
 *
 * - a request answers without waiting for a gateway;
 * - a gateway that fails is asked again, on the schedule the domain gives,
 *   and after the fifth refusal the message is failed, with what was said;
 * - a message whose words are no longer in memory (a restart) is sent from
 *   its row, with a fresh link issued for it, and is never sent with a hole
 *   where the link was;
 * - two senders never take the same message.
 *
 * Runs against the seeded demo database (CLAUDE.md §6), on a chamber of its
 * own. Time is moved by moving a row's `next_attempt_at`, which is what time
 * does to it.
 */

import { createHash } from 'node:crypto';

import { sql } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';

import { SEND_MAX_ATTEMPTS, type StaffRole } from '@platform/domain';

import { resetSmsAdapter, setSmsAdapter, type SmsMessage } from '../adapters/sms.js';
import { db } from '../config/db.js';
import { verifyToken } from '../config/jwt.js';
import { resetEmitter } from '../realtime/emit.js';
import * as guestRepo from '../repositories/guest.repo.js';
import * as notificationRepo from '../repositories/notification.repo.js';
import { withTransaction } from '../repositories/transaction.js';
import * as notifications from '../services/notification.service.js';
import * as sender from '../services/notificationSender.service.js';
import * as queueService from '../services/queue.service.js';

import { createQueueFixture, type QueueFixture } from './support/queueFixture.js';
import { RecordingSmsAdapter } from './support/recordingSms.js';

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
  readonly attempts: number;
  /** Seconds from now until it is due; negative when it already is. */
  readonly dueIn: number;
}

/** This chamber's messages of one kind, by SMS, oldest first. */
async function rowsOf(templateKey: string): Promise<Row[]> {
  const result = await sql<{
    id: string;
    state: string;
    error: string | null;
    attempts: number;
    due_in: string;
  }>`
    SELECT n.id, n.state::text AS state, n.error, n.attempts,
           extract(epoch FROM n.next_attempt_at - now())::text AS due_in
      FROM notifications n
     WHERE n.template_key = ${templateKey} AND n.channel = 'sms'
       AND (n.params ->> 'bookingId')::uuid IN (
             SELECT id FROM bookings WHERE session_id = ${fixture.sessionId}::uuid)
     ORDER BY n.queued_at, n.id
  `.execute(db);
  return result.rows.map((row) => ({
    id: row.id,
    state: row.state,
    error: row.error,
    attempts: row.attempts,
    dueIn: Number(row.due_in),
  }));
}

/** Makes a queued message due now, as the passing of its wait would. */
async function makeDue(ids: readonly string[]): Promise<void> {
  await sql`
    UPDATE notifications SET next_attempt_at = now() - interval '1 second'
     WHERE id = ANY(${ids}::uuid[]) AND state = 'queued'
  `.execute(db);
}

/** One tick of the sender, to its end. */
async function tick(): Promise<void> {
  sender.wake();
  await notifications.settled();
}

async function declareDelay(): Promise<void> {
  await queueService.appendEvent({
    sessionId: fixture.sessionId,
    type: 'DELAY_DECLARED',
    payload: { minutes: 30, reason: null, declaredBy: 'reception' },
    actor: staff(),
  });
}

beforeEach(async () => {
  resetEmitter();
  notifications.forgetTemplates();
  sender.forgetInMemory();
  setSmsAdapter(new RecordingSmsAdapter());
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

describe('a request does not wait for a gateway (plan H1)', () => {
  it('answers while the gateway is still being asked, and the message goes when it answers', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let asked = 0;
    setSmsAdapter({
      name: 'slow',
      send: async (message) => {
        asked += 1;
        await held;
        return { ok: true, providerRef: `slow:${message.notificationId}`, costPoisha: 35 };
      },
    });

    // The queue action is done and answered. The gateway has not answered.
    await declareDelay();
    const during = await rowsOf('queue.delayed');
    expect(during.length).toBeGreaterThan(0);
    expect(during.every((row) => row.state === 'queued')).toBe(true);

    release();
    await notifications.settled();
    expect(asked).toBe(during.length);
    expect((await rowsOf('queue.delayed')).every((row) => row.state === 'sent')).toBe(true);
  });
});

describe('a gateway that fails is asked again (FR-NOT-06)', () => {
  it('keeps the message queued after a refusal, saying what was said and when it is next due', async () => {
    setSmsAdapter({
      name: 'refusing',
      send: async () => await Promise.resolve({ ok: false, error: 'gateway_timeout' }),
    });

    await declareDelay();
    await notifications.settled();

    for (const row of await rowsOf('queue.delayed')) {
      expect(row.state).toBe('queued');
      expect(row.error).toBe('gateway_timeout');
      expect(row.attempts).toBe(1);
      // A quarter of a minute, give or take the time this took.
      expect(row.dueIn).toBeGreaterThan(5);
      expect(row.dueIn).toBeLessThanOrEqual(15);
    }
  });

  it('sends it on a later try, with the words it was written with and the refusal cleared', async () => {
    // Refused twice, each of them, and taken the third time.
    const recording = new RecordingSmsAdapter();
    const refused = new Map<string, number>();
    setSmsAdapter({
      name: 'recovering',
      send: async (message) => {
        const soFar = refused.get(message.notificationId) ?? 0;
        if (soFar < 2) {
          refused.set(message.notificationId, soFar + 1);
          return { ok: false, error: 'gateway_timeout' };
        }
        return await recording.send(message);
      },
    });

    await declareDelay();
    await notifications.settled();
    const ids = (await rowsOf('queue.delayed')).map((row) => row.id);
    expect(ids.length).toBeGreaterThan(0);

    await makeDue(ids);
    await tick();
    for (const row of await rowsOf('queue.delayed')) {
      expect(row).toMatchObject({ state: 'queued', attempts: 2, error: 'gateway_timeout' });
      // The second wait is a minute.
      expect(row.dueIn).toBeGreaterThan(30);
      expect(row.dueIn).toBeLessThanOrEqual(60);
    }

    await makeDue(ids);
    await tick();
    for (const row of await rowsOf('queue.delayed')) {
      expect(row).toMatchObject({ state: 'sent', attempts: 3, error: null });
    }
    // The words each went with are the words it was written with: thirty minutes late.
    expect(recording.all()).toHaveLength(ids.length);
    for (const message of recording.all()) expect(message.body).toContain('৩০');
  });

  it('gives up after the fifth refusal, and the row says so', async () => {
    let asked = 0;
    setSmsAdapter({
      name: 'refusing',
      send: async () => {
        asked += 1;
        return await Promise.resolve({ ok: false, error: 'gateway_down' });
      },
    });

    await declareDelay();
    await notifications.settled();
    const ids = (await rowsOf('queue.delayed')).map((row) => row.id);

    for (let attempt = 2; attempt <= SEND_MAX_ATTEMPTS + 2; attempt += 1) {
      await makeDue(ids);
      await tick();
    }

    for (const row of await rowsOf('queue.delayed')) {
      expect(row).toMatchObject({
        state: 'failed',
        error: 'gateway_down',
        attempts: SEND_MAX_ATTEMPTS,
      });
    }
    // Asked five times each and not once more, however often the sender looked.
    expect(asked).toBe(ids.length * SEND_MAX_ATTEMPTS);
  });

  it('gives up at once where the gateway says asking again cannot help', async () => {
    setSmsAdapter({
      name: 'barred',
      send: async () =>
        await Promise.resolve({ ok: false, error: 'number_does_not_exist', retryable: false }),
    });

    await declareDelay();
    await notifications.settled();
    for (const row of await rowsOf('queue.delayed')) {
      expect(row).toMatchObject({ state: 'failed', error: 'number_does_not_exist', attempts: 1 });
    }
  });

  it('a gateway that throws is a failure like any other: the action stands and the message is tried again', async () => {
    setSmsAdapter({
      name: 'exploding',
      send: async () => {
        await Promise.resolve();
        throw new Error('socket hang up');
      },
    });

    await expect(declareDelay()).resolves.toBeUndefined();
    await notifications.settled();
    for (const row of await rowsOf('queue.delayed')) {
      expect(row).toMatchObject({ state: 'queued', error: 'dispatch_threw', attempts: 1 });
    }
  });
});

describe('two senders never take the same message (FOR UPDATE SKIP LOCKED)', () => {
  it('rows asked for at the same instant are shared out, each to one asker', async () => {
    // A gateway that never answers within this test: the messages stay queued
    // and claimed, then are made due again for the two askers below.
    setSmsAdapter({
      name: 'refusing',
      send: async () => await Promise.resolve({ ok: false, error: 'gateway_timeout' }),
    });
    await declareDelay();
    await notifications.settled();
    const ids = (await rowsOf('queue.delayed')).map((row) => row.id);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    await makeDue(ids);

    const [one, two] = await Promise.all([
      notificationRepo.claimDue(50, 120),
      notificationRepo.claimDue(50, 120),
    ]);
    const mine = new Set(ids);
    const taken = [...one, ...two].map((row) => row.id).filter((id) => mine.has(id));
    expect(taken.sort()).toEqual([...ids].sort());
    expect(new Set(taken).size).toBe(taken.length);

    // And a claimed row is nobody's until its claim runs out.
    const again = await notificationRepo.claimDue(50, 120);
    expect(again.some((row) => mine.has(row.id))).toBe(false);
  });
});

describe('a message sent from its row has a fresh link issued (FR-GST-05, 0035)', () => {
  /** What a restart leaves: the rows, and nothing in memory. */
  async function restart(): Promise<void> {
    await notifications.settled();
    sender.forgetInMemory();
  }

  function failFirstThenRecord(): RecordingSmsAdapter {
    const recording = new RecordingSmsAdapter();
    let first = true;
    setSmsAdapter({
      name: 'failing-once',
      send: async (message: SmsMessage) => {
        if (first) {
          first = false;
          return { ok: false, error: 'gateway_timeout' };
        }
        return await recording.send(message);
      },
    });
    return recording;
  }

  it('a booking’s confirmation: a new tracking link that opens the same booking', async () => {
    const bookingId = fixture.bookingIds[0] ?? '';
    const phone = `+88017${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`;
    await sql`
      UPDATE patients SET phone = ${phone}
       WHERE id = (SELECT patient_id FROM bookings WHERE id = ${bookingId}::uuid)
    `.execute(db);
    await withTransaction(
      async (trx) =>
        await guestRepo.findOrCreateIdentity(trx, { phone, displayName: 'অতিথি (ডেমো)' }),
    );

    const recording = failFirstThenRecord();
    const original = 'http://localhost:3000/s?b=1&t=the-original-token';
    const batch = await withTransaction(
      async (trx) =>
        await notifications.queueFor(
          trx,
          fixture.sessionId,
          notifications.planBookingConfirmed(bookingId, original),
        ),
    );
    await notifications.dispatch(batch);
    await restart();

    // The row has the words and no link, and says what the link was for.
    const kept = await sql<{ id: string; params: Record<string, string> }>`
      SELECT id, params FROM notifications WHERE id = ANY(${[...batch.ids]}::uuid[])
    `.execute(db);
    const row = kept.rows[0];
    expect(JSON.stringify(row?.params)).not.toContain('the-original-token');
    expect(row?.params['body']).toContain('{link}');
    expect(row?.params['linkKind']).toBe('booking');
    expect(row?.params['linkBase']).toBe('http://localhost:3000');

    await makeDue([...batch.ids]);
    await tick();

    const sent = recording.all().find((message) => message.notificationId === row?.id);
    expect(sent).toBeDefined();
    expect(sent?.body).not.toContain('{link}');
    expect(sent?.body).not.toContain('the-original-token');
    const url = new URL(/https?:\/\/\S+/.exec(sent?.body ?? '')?.[0] ?? '');
    expect(url.origin).toBe('http://localhost:3000');
    expect(url.pathname).toBe('/s');
    expect(url.searchParams.get('b')).toBe(bookingId);
    // The token in it is a live link to this booking, stored as its hash only.
    const token = url.searchParams.get('t') ?? '';
    const opened = await guestRepo.resolveTrackingToken(
      createHash('sha256').update(token).digest('hex'),
    );
    expect(opened?.bookingId).toBe(bookingId);
  });

  it('where no link can be issued the message is failed, never sent with a hole in it', async () => {
    // A number nobody has booked from: a tracking link is issued to the
    // identity behind a number, and this one has none.
    const bookingId = fixture.bookingIds[1] ?? '';
    const phone = `+88018${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`;
    await sql`
      UPDATE patients SET phone = ${phone}
       WHERE id = (SELECT patient_id FROM bookings WHERE id = ${bookingId}::uuid)
    `.execute(db);
    expect(await guestRepo.identityIdForPhone(phone)).toBeNull();

    const recording = failFirstThenRecord();
    const batch = await withTransaction(
      async (trx) =>
        await notifications.queueFor(
          trx,
          fixture.sessionId,
          notifications.planBookingConfirmed(
            bookingId,
            'http://localhost:3000/s?b=1&t=the-original-token',
          ),
        ),
    );
    await notifications.dispatch(batch);
    await restart();
    await makeDue([...batch.ids]);
    await tick();

    const after = await sql<{ state: string; error: string | null }>`
      SELECT state::text AS state, error FROM notifications
       WHERE id = ANY(${[...batch.ids]}::uuid[])
    `.execute(db);
    expect(after.rows).toEqual([{ state: 'failed', error: 'link_unavailable' }]);
    expect(recording.all()).toHaveLength(0);
  });

  it('a standby offer: a status token minted again for the same place', async () => {
    const recording = failFirstThenRecord();
    const standbyId = '0199c0de-0000-7000-8000-000000000001';
    const subject = '0199c0de-0000-7000-8000-000000000002';
    const batch = await withTransaction(
      async (trx) =>
        await notifications.queueSlotOffer(trx, {
          sessionId: fixture.sessionId,
          patientId: fixture.sparePatientId,
          phone: '+8801712345678',
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          link: 'http://localhost:3000/standby?t=the-original-token',
          standby: { id: standbyId, subject },
        }),
    );
    await notifications.dispatch(batch);
    await restart();
    await makeDue([...batch.ids]);
    await tick();

    const sent = recording.all().find((message) => batch.ids.includes(message.notificationId));
    expect(sent).toBeDefined();
    expect(sent?.body).not.toContain('the-original-token');
    const url = new URL(/https?:\/\/\S+/.exec(sent?.body ?? '')?.[0] ?? '');
    expect(url.pathname).toBe('/standby');
    const verified = await verifyToken(url.searchParams.get('t') ?? '', 'standby');
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.claims.standbyId).toBe(standbyId);
      expect(verified.claims.sub).toBe(subject);
    }
  });
});

describe('the log provider still records every message as sent (the demonstration)', () => {
  it('a queue action’s messages are sent by the time the sender is idle', async () => {
    resetSmsAdapter();
    await declareDelay();
    await notifications.settled();
    const rows = await rowsOf('queue.delayed');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.state === 'sent' && row.attempts === 1)).toBe(true);
  });
});
