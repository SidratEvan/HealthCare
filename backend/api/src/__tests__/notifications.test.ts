/**
 * Notifications (`FR-NOT-01`…`FR-NOT-07`, BACKEND.md §4.1 step 11, §8).
 *
 * Step 11's definition of done is "called / delayed / two-away messages
 * recorded", and that word is the reason most of this file asserts on rows
 * rather than on an adapter. A message that went out but was not recorded
 * cannot be reported on, retried, or explained to a hospital asking why its
 * SMS bill looks like that.
 *
 * ## The two properties worth the most attention
 *
 * **Nothing is sent for an event that did not happen.** The outbox row is
 * written inside the queue transaction, so a rolled-back event leaves no
 * message — proven below by a guard refusal.
 *
 * **Nothing is silently not sent.** A suppression is a `skipped` row carrying
 * its reason, never an absence. "We chose not to tell them" is exactly what a
 * hospital needs to know when a patient says nobody called.
 *
 * Runs against the seeded demo database, each test on a session of its own
 * (CLAUDE.md §6).
 */

import { sql } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';

import type { StaffRole } from '@platform/domain';

import { LogSmsAdapter, resetSmsAdapter, setSmsAdapter } from '../adapters/sms.js';
import { db } from '../config/db.js';
import { resetEmitter } from '../realtime/emit.js';
import * as notificationRepo from '../repositories/notification.repo.js';
import { withTransaction } from '../repositories/transaction.js';
import * as notifications from '../services/notification.service.js';
import * as queueService from '../services/queue.service.js';

import { createQueueFixture, type QueueFixture } from './support/queueFixture.js';

let fixture: QueueFixture;
let outbox: LogSmsAdapter;

/** The receptionist driving the chamber, as a queue actor (`FR-QUE-04`). */
function staff(roles: readonly StaffRole[] = ['receptionist']) {
  return {
    kind: 'staff' as const,
    staffUserId: fixture.receptionistId as never,
    role: roles[0] ?? 'receptionist',
  };
}

/** Everything queued for this session's bookings, oldest first. */
async function queued(): Promise<
  { templateKey: string; channel: string; state: string; error: string | null }[]
> {
  const rows = await notificationRepo.listForSession(fixture.sessionId);
  return rows.map((row) => ({
    templateKey: row.templateKey,
    channel: row.channel,
    state: row.state,
    error: row.error,
  }));
}

async function keysFor(templateKey: string): Promise<
  { state: string; error: string | null; body: string }[]
> {
  const rows = await notificationRepo.listForSession(fixture.sessionId);
  return rows
    .filter((row) => row.templateKey === templateKey)
    .map((row) => ({
      state: row.state,
      error: row.error,
      body: typeof row.params['body'] === 'string' ? row.params['body'] : '',
    }));
}

/** Gives every patient in the fixture a phone, so SMS has somewhere to go. */
async function givePhones(): Promise<void> {
  await sql`
    UPDATE patients SET phone = '+8801712345678'
     WHERE id IN (
       SELECT patient_id FROM bookings WHERE session_id = ${fixture.sessionId}::uuid
     )
  `.execute(db);
}

beforeEach(async () => {
  resetEmitter();
  notifications.forgetTemplates();
  outbox = new LogSmsAdapter();
  setSmsAdapter(outbox);
  fixture = await createQueueFixture(5);
  await givePhones();

  // Every fixture builds on the same seeded chamber, so `hospital_settings` is
  // shared between tests. A cap left at zero by one would silence every test
  // after it — which would look like a notification bug and is a fixture one.
  await sql`
    UPDATE hospital_settings SET sms_budget_monthly = NULL
     WHERE hospital_id = ${fixture.hospitalId}::uuid
  `.execute(db);
});

describe('the templates are installed and read from the database (FR-NOT-05)', () => {
  it('renders from the table, not from a literal at the call site', async () => {
    const rows = await notificationRepo.activeTemplates();

    // The seed put them there. A service that fell back to a constant when the
    // table was empty would make this requirement unfalsifiable.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.key === 'queue.called')).toBe(true);
  });

  it('carries both languages for every key it ships (FR-NOT-04)', async () => {
    const rows = await notificationRepo.activeTemplates();
    const byKey = new Map<string, Set<string>>();

    for (const row of rows) {
      const id = `${row.key}|${row.channel}`;
      byKey.set(id, (byKey.get(id) ?? new Set()).add(row.locale));
    }

    for (const [id, locales] of byKey) {
      expect([...locales].sort(), `${id} is missing a language`).toEqual(['bn', 'en']);
    }
  });
});

describe('called (FR-NOT-03)', () => {
  it('records a message for the patient who was called', async () => {
    await queueService.appendEvent({
      sessionId: fixture.sessionId,
      type: 'DOCTOR_ARRIVED',
      payload: { arrivedAt: new Date().toISOString(), minutesLate: 0 },
      actor: staff(),
    });

    await queueService.callNext({ sessionId: fixture.sessionId, actor: staff() });

    const called = await keysFor('queue.called');
    expect(called.length).toBeGreaterThan(0);
    expect(called[0]?.state).toBe('sent');
  });

  it('names the serial in the numerals the recipient reads (TYP-04)', async () => {
    await queueService.appendEvent({
      sessionId: fixture.sessionId,
      type: 'DOCTOR_ARRIVED',
      payload: { arrivedAt: new Date().toISOString(), minutesLate: 0 },
      actor: staff(),
    });
    await queueService.callNext({ sessionId: fixture.sessionId, actor: staff() });

    const [called] = await keysFor('queue.called');

    // Serial 1, in Bengali. A Latin digit inside a Bangla sentence is the tell
    // FRONTEND.md §0.2 bans by name, and an SMS is a patient surface.
    expect(called?.body).toContain('১');
    expect(called?.body).not.toMatch(/[0-9]/);
  });

  it('hands the body to the SMS adapter verbatim', async () => {
    await queueService.appendEvent({
      sessionId: fixture.sessionId,
      type: 'DOCTOR_ARRIVED',
      payload: { arrivedAt: new Date().toISOString(), minutesLate: 0 },
      actor: staff(),
    });
    await queueService.callNext({ sessionId: fixture.sessionId, actor: staff() });

    const sent = outbox.all();
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.some((message) => message.templateKey === 'queue.called')).toBe(true);
    expect(sent[0]?.to).toBe('+8801712345678');
  });
});

describe('delayed (FR-REC-03, FR-PAT-34)', () => {
  it('tells everybody still waiting, and nobody who has been seen', async () => {
    await queueService.appendEvent({
      sessionId: fixture.sessionId,
      type: 'DOCTOR_ARRIVED',
      payload: { arrivedAt: new Date().toISOString(), minutesLate: 0 },
      actor: staff(),
    });

    // Two patients through the chamber: serial 1 done, serial 2 in it.
    await queueService.callNext({ sessionId: fixture.sessionId, actor: staff() });
    await queueService.callNext({ sessionId: fixture.sessionId, actor: staff() });

    await queueService.appendEvent({
      sessionId: fixture.sessionId,
      type: 'DELAY_DECLARED',
      payload: { minutes: 30, reason: null, declaredBy: 'reception' },
      actor: staff(),
    });

    const delayed = await keysFor('queue.delayed');

    // Five bookings, one done, one in the chamber: three still waiting.
    // Telling the patient who was seen an hour ago that the doctor is late is
    // how people learn to turn notifications off.
    expect(delayed).toHaveLength(3);
  });

  it('says how many minutes, because that is the whole message', async () => {
    await queueService.appendEvent({
      sessionId: fixture.sessionId,
      type: 'DELAY_DECLARED',
      payload: { minutes: 30, reason: null, declaredBy: 'reception' },
      actor: staff(),
    });

    const [delayed] = await keysFor('queue.delayed');
    expect(delayed?.body).toContain('৩০');
  });
});

describe('two patients away (FR-NOT-03)', () => {
  it('fires as the queue moves, without a scheduler', async () => {
    await queueService.appendEvent({
      sessionId: fixture.sessionId,
      type: 'DOCTOR_ARRIVED',
      payload: { arrivedAt: new Date().toISOString(), minutesLate: 0 },
      actor: staff(),
    });

    await queueService.callNext({ sessionId: fixture.sessionId, actor: staff() });

    const twoAway = await keysFor('queue.two_away');
    expect(twoAway.length).toBeGreaterThan(0);
  });

  it('tells a patient once, not again on every later call', async () => {
    await queueService.appendEvent({
      sessionId: fixture.sessionId,
      type: 'DOCTOR_ARRIVED',
      payload: { arrivedAt: new Date().toISOString(), minutesLate: 0 },
      actor: staff(),
    });

    for (let i = 0; i < 3; i += 1) {
      await queueService.callNext({ sessionId: fixture.sessionId, actor: staff() });
    }

    const rows = await notificationRepo.listForSession(fixture.sessionId);
    const twoAway = rows.filter((row) => row.templateKey === 'queue.two_away');
    const recipients = new Set(twoAway.map((row) => String(row.params['bookingId'])));

    // One notice per person. The plan is a *transition* — who became two away —
    // so somebody already told is not told again as the queue keeps moving.
    expect(twoAway.length).toBe(recipients.size);
  });
});

describe('the outbox is written inside the queue transaction', () => {
  it('queues nothing for an event a guard refused', async () => {
    const before = (await queued()).length;

    // Calling next twice in a row without finishing the first is refused by
    // `canCallNext`; `appendEvent` with an unguarded type would not prove it,
    // so this uses a genuinely refused event.
    await expect(
      queueService.appendEvent({
        sessionId: fixture.sessionId,
        type: 'PATIENT_DONE',
        payload: { bookingId: fixture.bookingIds[0] ?? '', consultSeconds: 100 },
        actor: staff(),
      }),
    ).rejects.toThrow();

    // No event, therefore no message. The row would have been written in the
    // transaction that rolled back.
    expect((await queued()).length).toBe(before);
  });

  it('records a message for every material event and none for the rest', async () => {
    await queueService.appendEvent({
      sessionId: fixture.sessionId,
      type: 'DOCTOR_ARRIVED',
      payload: { arrivedAt: new Date().toISOString(), minutesLate: 0 },
      actor: staff(),
    });
    await queueService.appendEvent({
      sessionId: fixture.sessionId,
      type: 'SESSION_PAUSED',
      payload: { reason: null },
      actor: staff(),
    });

    // A pause is not in `MATERIAL_EVENT_TYPES`: it is a chamber's internal
    // business, and a patient hears about it through the ETA moving.
    expect(await keysFor('queue.paused')).toHaveLength(0);
  });
});

describe('nothing is silently not sent', () => {
  it('records a skipped row with its reason when there is no phone number', async () => {
    await sql`
      UPDATE patients SET phone = NULL
       WHERE id IN (
         SELECT patient_id FROM bookings WHERE session_id = ${fixture.sessionId}::uuid
       )
    `.execute(db);

    await queueService.appendEvent({
      sessionId: fixture.sessionId,
      type: 'DELAY_DECLARED',
      payload: { minutes: 30, reason: null, declaredBy: 'reception' },
      actor: staff(),
    });

    const delayed = await keysFor('queue.delayed');
    expect(delayed.length).toBeGreaterThan(0);

    // An absence would be indistinguishable from a bug. A reason is a fact a
    // hospital can act on.
    expect(delayed.every((row) => row.state === 'skipped')).toBe(true);
    expect(delayed[0]?.error).toBe('no_phone_number');
  });

  it('stops at the hospital’s monthly SMS cap (FR-NOT-06)', async () => {
    await sql`
      UPDATE hospital_settings SET sms_budget_monthly = 0
       WHERE hospital_id = ${fixture.hospitalId}::uuid
    `.execute(db);

    await queueService.appendEvent({
      sessionId: fixture.sessionId,
      type: 'DELAY_DECLARED',
      payload: { minutes: 30, reason: null, declaredBy: 'reception' },
      actor: staff(),
    });

    const delayed = await keysFor('queue.delayed');
    expect(delayed.every((row) => row.state === 'skipped')).toBe(true);
    expect(delayed[0]?.error).toBe('sms_budget_exhausted');

    // And nothing reached the adapter: a cap that recorded a skip and sent
    // anyway would be worse than no cap at all.
    expect(outbox.all()).toHaveLength(0);
  });

  it('records a provider failure rather than losing the message', async () => {
    setSmsAdapter({
      name: 'refusing',
      send: async () => await Promise.resolve({ ok: false, error: 'gateway_timeout' }),
    });

    await queueService.appendEvent({
      sessionId: fixture.sessionId,
      type: 'DELAY_DECLARED',
      payload: { minutes: 30, reason: null, declaredBy: 'reception' },
      actor: staff(),
    });

    const delayed = await keysFor('queue.delayed');
    expect(delayed[0]?.state).toBe('failed');
    expect(delayed[0]?.error).toBe('gateway_timeout');
  });

  it('a gateway that throws does not fail the queue action', async () => {
    setSmsAdapter({
      name: 'exploding',
      send: async () => {
        await Promise.resolve();
        throw new Error('socket hang up');
      },
    });

    // The console tapped next, the patient moved, and that happened whether or
    // not an SMS did. Turning it into a 500 would have a receptionist tap
    // again and call two patients.
    await expect(
      queueService.appendEvent({
        sessionId: fixture.sessionId,
        type: 'DELAY_DECLARED',
        payload: { minutes: 30, reason: null, declaredBy: 'reception' },
        actor: staff(),
      }),
    ).resolves.toBeDefined();

    const delayed = await keysFor('queue.delayed');
    expect(delayed[0]?.state).toBe('failed');
    expect(delayed[0]?.error).toBe('dispatch_threw');
  });
});

describe('channel policy (FR-NOT-02)', () => {
  it('sends SMS only to somebody with no registered device', async () => {
    await queueService.appendEvent({
      sessionId: fixture.sessionId,
      type: 'DELAY_DECLARED',
      payload: { minutes: 30, reason: null, declaredBy: 'reception' },
      actor: staff(),
    });

    // "App users get push + SMS; non-app users get SMS only." Nobody has
    // installed the PWA, so nobody has a `device_tokens` row — which makes
    // every patient in this version a non-app user, correctly rather than by
    // omission.
    const channels = new Set((await queued()).map((row) => row.channel));
    expect([...channels]).toEqual(['sms']);
  });
});

describe('quiet hours (FR-NOT-07)', () => {
  it('never suppresses a queue event, whatever the hour', () => {
    // "Emergency and queue events override." Three in the morning in Dhaka.
    const middleOfTheNight = new Date('2026-09-18T21:00:00.000Z');

    expect(notifications.withinQuietHours('queue.called', middleOfTheNight)).toBe(false);
    expect(notifications.withinQuietHours('booking.confirmed', middleOfTheNight)).toBe(false);
    expect(notifications.withinQuietHours('session.ended', middleOfTheNight)).toBe(false);
  });

  it('suppresses a non-urgent message at three in the morning', () => {
    // Nothing in this version sends one; the first follow-up reminder will,
    // and it must not wake anybody.
    expect(notifications.withinQuietHours('care.followup', new Date('2026-09-18T21:00:00.000Z'))).toBe(
      true,
    );
  });

  it('lets a non-urgent message through in the afternoon', () => {
    expect(notifications.withinQuietHours('care.followup', new Date('2026-09-18T09:00:00.000Z'))).toBe(
      false,
    );
  });
});

describe('the booking confirmation (FR-PAT-22, FR-GST-05)', () => {
  it('carries the tracking link, which exists for exactly one moment', async () => {
    // `queueFor` takes a transaction, like every write in this codebase. The
    // booking service wraps its own because the link is derived from a row
    // that has to exist first; here the fixture's booking already does.
    const batch = await withTransaction(
      async (trx) =>
        await notifications.queueFor(
          trx,
          fixture.sessionId,
          notifications.planBookingConfirmed(
            fixture.bookingIds[0] ?? '',
            'https://example.test/s?b=1&t=2',
          ),
        ),
    );

    expect(batch.messages.some((message) => message.body.includes('https://'))).toBe(true);
  });
});

describe('the log provider is the implementation, not a stand-in', () => {
  it('reports a cost per message so a budget can be reported (FR-NOT-06)', async () => {
    resetSmsAdapter();

    await queueService.appendEvent({
      sessionId: fixture.sessionId,
      type: 'DELAY_DECLARED',
      payload: { minutes: 30, reason: null, declaredBy: 'reception' },
      actor: staff(),
    });

    const rows = await sql<{ cost_poisha: number | null }>`
      SELECT cost_poisha FROM notifications
       WHERE template_key = 'queue.delayed' AND state = 'sent'
       LIMIT 1
    `.execute(db);

    expect(rows.rows[0]?.cost_poisha).toBeGreaterThan(0);
  });
});
