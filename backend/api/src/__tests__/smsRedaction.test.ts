/**
 * What a message leaves behind (`docs/PLATFORM_PLAN.md` 1.9; `docs/HANDOVER.md`
 * §12 items 11 and 13; CLAUDE.md §7; DATABASE.md §8).
 *
 * An SMS from this product is three things CLAUDE.md §7 says are never
 * logged, at once: it is addressed to a patient's phone, it names their
 * serial, and a booking's carries the tracking link — a credential that opens
 * that booking's queue, its signed record and its reports (`FR-GST-05`).
 *
 * Three places used to keep all of it, and each is proved empty here:
 *
 *   - **the server's log.** `SMS_PROVIDER=log` printed the number and the text
 *     with `console.log`, past the logger's redaction — and `log` is what a
 *     hospital's own server runs until an aggregator exists;
 *   - **the process.** The same provider kept every message in an array that
 *     nothing cleared;
 *   - **the database.** The link was stored twice in each row, as a parameter
 *     and inside the rendered text, beside the hash that was supposed to be
 *     the only trace of it.
 *
 * And one thing is proved still true, because a fix that broke it would pass
 * every assertion above: **the patient still receives the link.**
 *
 * Runs against the seeded demo database (CLAUDE.md §6).
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LogSmsAdapter, resetSmsAdapter, setSmsAdapter } from '../adapters/sms.js';
import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { logger } from '../config/logger.js';
import { resetEmitter } from '../realtime/emit.js';
import { withTransaction } from '../repositories/transaction.js';
import * as notifications from '../services/notification.service.js';

import { createQueueFixture, type QueueFixture } from './support/queueFixture.js';
import { RecordingSmsAdapter } from './support/recordingSms.js';
import { rowsHoldingALink } from './support/storedLinks.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let fixture: QueueFixture;

/** A distinct phone per test, so guest identities never collide. */
function guestPhone(): string {
  const tail = String(Math.floor(Math.random() * 90_000_000) + 10_000_000);
  return `+88019${tail}`;
}

/**
 * Everything the process writes while a test runs: `console`, the two
 * streams, and every level of the logger.
 *
 * The logger is silent under test, so its calls are captured as arguments —
 * which is stricter than reading its output would be, since nothing has been
 * redacted yet.
 */
function captureEverythingWritten(): { text: () => string } {
  const written: unknown[] = [];
  const keep = (...parts: unknown[]): void => {
    written.push(...parts);
  };

  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation(keep);
  }
  for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
    vi.spyOn(logger, level).mockImplementation(keep);
  }
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    keep(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    keep(chunk);
    return true;
  });

  return {
    text: () =>
      written.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join('\n'),
  };
}

/** A guest books over HTTP, as the patient app does. */
async function bookAsGuest(phone: string): Promise<{ bookingId: string; trackingUrl: string }> {
  const response = await request(app)
    .post(`${BASE}/bookings`)
    .set('Idempotency-Key', randomUUID())
    .send({
      sessionId: fixture.sessionId,
      method: 'at_hospital',
      guest: { name: 'রহিমা খাতুন (ডেমো)', phone, ageYears: 34, sex: 'female' },
    });

  expect(response.status).toBe(201);
  return response.body.data as { bookingId: string; trackingUrl: string };
}

/** The outbox rows written for one booking's confirmation. */
async function confirmationRows(
  bookingId: string,
): Promise<{ params: Record<string, unknown>; phone: string | null; state: string }[]> {
  const result = await sql<{
    params: Record<string, unknown>;
    phone: string | null;
    state: string;
  }>`
    SELECT params, phone, state::text AS state
      FROM notifications
     WHERE template_key = 'booking.confirmed' AND params ->> 'bookingId' = ${bookingId}
  `.execute(db);
  return result.rows;
}

beforeEach(async () => {
  app = createApp();
  resetEmitter();
  notifications.forgetTemplates();
  fixture = await createQueueFixture(3);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetSmsAdapter();
});

describe('the log provider (SMS_PROVIDER=log)', () => {
  const PHONE = '+8801712345678';
  const BODY = 'সিরিয়াল ১২ — লাইভ দেখুন: https://app.example.test/s?b=1&t=a-working-token';

  it('writes neither the number nor the text, anywhere', async () => {
    const written = captureEverythingWritten();

    const result = await new LogSmsAdapter().send({
      to: PHONE,
      body: BODY,
      notificationId: 'notification-1',
      templateKey: 'booking.confirmed',
    });

    const everything = written.text();
    expect(everything).not.toContain(PHONE);
    // Nor the number in the form a patient types it.
    expect(everything).not.toContain('01712345678');
    expect(everything).not.toContain('a-working-token');
    expect(everything).not.toContain('সিরিয়াল');

    // It is still a log provider: one line saying which message, and nothing
    // about whose it was or what it said.
    expect(everything).toContain('notification-1');
    expect(everything).toContain('booking.confirmed');
    expect(result.ok).toBe(true);
  });

  it('keeps nothing once the message has been handed over', async () => {
    const adapter = new LogSmsAdapter();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    for (let index = 0; index < 3; index += 1) {
      await adapter.send({
        to: PHONE,
        body: BODY,
        notificationId: `notification-${String(index)}`,
        templateKey: 'booking.confirmed',
      });
    }

    // Whatever the object holds, it is not the messages: a server that runs
    // for months would otherwise hold every text it ever sent.
    const held = JSON.stringify(Object.entries(adapter));
    expect(held).not.toContain(PHONE);
    expect(held).not.toContain('a-working-token');
    expect('all' in adapter).toBe(false);
  });

  it('still reports what a message would cost, so a budget can be reported (FR-NOT-06)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = await new LogSmsAdapter().send({
      to: PHONE,
      body: BODY,
      notificationId: 'notification-1',
      templateKey: 'booking.confirmed',
    });

    expect(result).toMatchObject({ ok: true, providerRef: 'log:notification-1' });
    expect(result.ok && result.costPoisha).toBeGreaterThan(0);
  });
});

describe('a booking’s confirmation (FR-PAT-22, FR-GST-05)', () => {
  it('still sends the patient the link', async () => {
    const outbox = new RecordingSmsAdapter();
    setSmsAdapter(outbox);
    const phone = guestPhone();

    const booked = await bookAsGuest(phone);

    // Sent by the sender once the booking has answered (plan H1).
    await notifications.settled();
    const sent = outbox.all().filter((message) => message.templateKey === 'booking.confirmed');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(phone);
    // The whole link, exactly as the booking screen was given it.
    expect(sent[0]?.body).toContain(booked.trackingUrl);
  });

  it('leaves no link in the table', async () => {
    setSmsAdapter(new RecordingSmsAdapter());

    const booked = await bookAsGuest(guestPhone());
    const token = new URL(booked.trackingUrl).searchParams.get('t') ?? '';
    expect(token.length).toBeGreaterThan(20);

    const rows = await confirmationRows(booked.bookingId);
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const stored = JSON.stringify(row.params);
      expect(stored).not.toContain(token);
      expect(stored).not.toContain(booked.trackingUrl);
      expect(row.params).not.toHaveProperty('link');

      // What was sent can still be read back: the same words, with the link's
      // place marked and the link itself not there.
      expect(String(row.params['body'])).toContain('{link}');
      expect(String(row.params['body'])).not.toMatch(/https?:\/\//);
    }

    expect(await rowsHoldingALink()).toBe(0);
  });

  it('leaves no link and no number in the log', async () => {
    // The provider a hospital's server runs until an aggregator exists.
    resetSmsAdapter();
    const written = captureEverythingWritten();
    const phone = guestPhone();

    const booked = await bookAsGuest(phone);
    const token = new URL(booked.trackingUrl).searchParams.get('t') ?? '';
    // The sender works after the answer (plan H1); since plan H3 the booking
    // hands its message over last, so this waits for it as other tests do.
    await notifications.settled();

    const everything = written.text();
    expect(everything).not.toContain(token);
    expect(everything).not.toContain(phone);
    expect(everything).not.toContain(phone.replace('+88', ''));

    // And it went: the row says so.
    const rows = await confirmationRows(booked.bookingId);
    expect(rows.map((row) => row.state)).toEqual(['sent']);
  });
});

describe('what is kept of a message (forTheRecord)', () => {
  it('keeps the words and leaves the link as its placeholder', () => {
    const kept = notifications.forTheRecord('সিরিয়াল {serial}। লাইভ দেখুন: {link}', {
      serial: '১২',
      link: 'https://app.example.test/s?b=1&t=a-working-token',
    });

    expect(kept.body).toBe('সিরিয়াল ১২। লাইভ দেখুন: {link}');
    expect(kept.params).toEqual({ serial: '১২' });
  });

  it('does not claim a link was sent when none was', () => {
    // An account holder's confirmation has no tracking link: the app is their
    // link. The record must read as the message did, not as though a link had
    // been taken out of it.
    const kept = notifications.forTheRecord('সিরিয়াল {serial}। {link}', {
      serial: '১২',
      link: '',
    });

    expect(kept.body).toBe('সিরিয়াল ১২। ');
    expect(kept.params).toEqual({ serial: '১২' });
  });
});

describe('ninety days on (DATABASE.md §8: bodies 90 days, metadata kept)', () => {
  /** Writes one confirmation for the fixture's first booking and returns its row id. */
  async function queueOne(): Promise<string> {
    const batch = await withTransaction(
      async (trx) =>
        await notifications.queueFor(
          trx,
          fixture.sessionId,
          notifications.planBookingConfirmed(fixture.bookingIds[0] ?? '', null),
        ),
    );
    const id = batch.ids[0];
    if (id === undefined) throw new Error('the fixture should have produced a message');
    return id;
  }

  async function ageTo(id: string, days: number): Promise<void> {
    await sql`
      UPDATE notifications SET queued_at = now() - (${days}::int * interval '1 day')
       WHERE id = ${id}::uuid
    `.execute(db);
  }

  async function rowOf(id: string): Promise<{
    params: Record<string, unknown>;
    template_key: string;
    state: string;
  }> {
    const result = await sql<{
      params: Record<string, unknown>;
      template_key: string;
      state: string;
    }>`
      SELECT params, template_key, state::text AS state FROM notifications WHERE id = ${id}::uuid
    `.execute(db);
    const row = result.rows[0];
    if (row === undefined) throw new Error('no such notification');
    return row;
  }

  it('clears the words of a message older than ninety days and keeps what it was about', async () => {
    const id = await queueOne();
    await ageTo(id, 91);
    const before = await rowOf(id);
    expect(before.params).toHaveProperty('body');
    expect(before.params).toHaveProperty('serial');

    const cleared = await notifications.clearExpiredBodies();
    expect(cleared).toBeGreaterThanOrEqual(1);

    const row = await rowOf(id);
    // Gone: the text, and everything that filled it. Kept: which booking,
    // which message, what became of it.
    expect(row.params).toEqual({ bookingId: fixture.bookingIds[0] });
    expect(row.template_key).toBe('booking.confirmed');
    expect(row.state).toBe(before.state);
  });

  it('leaves a message of eighty-nine days exactly as it was', async () => {
    const id = await queueOne();
    await ageTo(id, 89);
    const before = await rowOf(id);

    await notifications.clearExpiredBodies();

    expect(await rowOf(id)).toEqual(before);
    expect(before.params).toHaveProperty('body');
  });

  it('has nothing left to do the second time', async () => {
    const id = await queueOne();
    await ageTo(id, 120);

    await notifications.clearExpiredBodies();
    expect(await notifications.clearExpiredBodies()).toBe(0);
  });
});
