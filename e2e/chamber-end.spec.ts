/**
 * `e2e/chamber-end.spec.ts` — ending a chamber (`BTN-B02-END`, `MOD-B02-END`,
 * `S-B-01`; owner's decisions of 2026-10-05).
 *
 * Until this control existed nothing in the product ended a chamber. The
 * route was there and no screen called it, so a chamber stayed "running" for
 * ever: the next morning it was the first one the picker offered, its card
 * showed no date, and today's walk-ins went into yesterday's queue.
 *
 * What ending must not do is strand anybody silently. So these specs are
 * mostly about what it refuses and what it leaves alone:
 *
 *   - it is off while a patient is in the chamber, and the server refuses it
 *     too — which is what a second counter with a stale screen is told;
 *   - patients left unseen are counted in the confirmation, which then needs a
 *     deliberate tick, and ending changes none of their statuses;
 *   - yesterday's chamber and today's are told apart on the picker, and ending
 *     one leaves the other exactly as it was.
 */

import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import {
  chamberRecord,
  createConsoleSession,
  eventTypes,
  hideFromPicker,
  queueAction,
  type ConsoleSession,
} from './support/console.js';
import { putReceptionistInTab } from './support/consoleSession.js';

const CONSOLE = 'http://localhost:3100';

/** Fixture chambers a spec put on the picker, to be taken back off it. */
const onPicker: string[] = [];

test.afterEach(async () => {
  await hideFromPicker(onPicker.splice(0));
});

function bookingAt(demo: ConsoleSession, serial: number): string {
  const booking = demo.bookingsBySerial.get(serial);
  if (booking === undefined) throw new Error(`no serial ${String(serial)} in the fixture`);
  return booking;
}

async function openConsole(page: Page, demo: ConsoleSession): Promise<void> {
  await putReceptionistInTab(page, demo);
  await page.goto(`${CONSOLE}/?session=${demo.sessionId}`);
  await expect(page.getByTestId('queue-table')).toBeVisible();
  // An end needs the server, so the control is only on once it can be reached.
  await expect(page.getByTestId('offline-block')).toHaveAttribute('data-connected', 'true', {
    timeout: 15_000,
  });
}

test.describe('ending a chamber (BTN-B02-END)', () => {
  test('a chamber with nobody left is ended with one confirmation', async ({ page }) => {
    // One patient, in the chamber when the fixture opens; then finished.
    const demo = await createConsoleSession(1);
    await queueAction(demo, `/bookings/${bookingAt(demo, 1)}/done`);

    await openConsole(page, demo);
    await expect(page.getByTestId('now-serving')).toHaveCount(0);

    await page.getByTestId('end-chamber').click();
    await expect(page.getByTestId('end-chamber-sheet')).toBeVisible();
    // Nobody is waiting, so there is nothing to acknowledge: the consequence
    // is stated and one deliberate press ends it.
    await expect(page.getByTestId('end-unseen')).toHaveAttribute('data-unseen', '0');
    await expect(page.getByTestId('end-unseen')).toContainText(
      'চেম্বার শেষ করলে এই সেশনে আর কোনো কাজ করা যাবে না।',
    );
    await expect(page.getByTestId('end-acknowledge')).toHaveCount(0);
    await page.getByTestId('end-confirm').click();

    // The screen says so, the control is gone, and nothing else can be done.
    await expect(page.getByTestId('ended-banner')).toBeVisible();
    await expect(page.getByTestId('end-chamber')).toHaveCount(0);
    await expect(page.getByTestId('call-next')).toBeDisabled();
    await expect(page.getByTestId('add-walkin')).toBeDisabled();

    expect((await eventTypes(demo.sessionId)).at(-1)).toBe('SESSION_ENDED');
    const record = await chamberRecord(demo.sessionId);
    expect(record.status).toBe('ended');
    // The one patient is still what they were: seen.
    expect(record.bookings).toEqual(['done']);
  });

  test('it is off, and says why, while a patient is in the chamber', async ({ page }) => {
    const demo = await createConsoleSession(3);
    await openConsole(page, demo);
    await expect(page.getByTestId('now-serving')).toHaveText('১');

    await expect(page.getByTestId('end-chamber')).toBeDisabled();
    await expect(page.getByTestId('end-chamber')).toHaveAttribute(
      'title',
      'একজন রোগী চেম্বারে আছেন। আগে তাঁর দেখা শেষ করুন।',
    );
    expect(await eventTypes(demo.sessionId)).not.toContain('SESSION_ENDED');
  });

  test('a counter whose screen is behind is refused by the server, and its screen is put right', async ({
    page,
  }) => {
    // Everything the server says on this counter's socket goes through a
    // gate, so its screen can be held at a moment that has passed.
    let held = false;
    const waiting: (() => void)[] = [];
    await page.routeWebSocket(/socket\.io/, (socket) => {
      const server = socket.connectToServer();
      socket.onMessage((message) => {
        server.send(message);
      });
      server.onMessage((message) => {
        if (held) waiting.push(() => socket.send(message));
        else socket.send(message);
      });
    });

    const demo = await createConsoleSession(3);
    await queueAction(demo, `/bookings/${bookingAt(demo, 1)}/done`);
    await openConsole(page, demo);
    await expect(page.getByTestId('now-serving')).toHaveCount(0);

    // Another counter calls serial 2 in. This one is not told.
    held = true;
    await queueAction(demo, `/sessions/${demo.sessionId}/next`);
    await expect.poll(() => waiting.length).toBeGreaterThan(0);
    await expect(page.getByTestId('now-serving')).toHaveCount(0);
    await expect(page.getByTestId('end-chamber')).toBeEnabled();

    // So, as far as this screen knows, the chamber is empty and may be ended.
    await page.getByTestId('end-chamber').click();
    await page.getByTestId('end-acknowledge').check();
    await page.getByTestId('end-confirm').click();

    // The server knows better: it refuses, nothing is written, and the screen
    // is brought up to date from the server itself — the socket is still held.
    await expect(page.getByText('চেম্বার শেষ হয়নি', { exact: false }).first()).toBeVisible();
    await expect(page.getByTestId('now-serving')).toHaveText('২');
    await expect(page.getByTestId('end-chamber')).toBeDisabled();
    await expect(page.getByTestId('ended-banner')).toHaveCount(0);

    expect(await eventTypes(demo.sessionId)).not.toContain('SESSION_ENDED');
    expect((await chamberRecord(demo.sessionId)).status).toBe('running');
  });

  test('patients left unseen are counted, need a deliberate tick, and are left as they were', async ({
    page,
  }) => {
    const demo = await createConsoleSession(4);
    await queueAction(demo, `/bookings/${bookingAt(demo, 1)}/done`);
    await openConsole(page, demo);
    const before = await chamberRecord(demo.sessionId);

    await page.getByTestId('end-chamber').click();
    await expect(page.getByTestId('end-unseen')).toContainText('৩ জন রোগীকে দেখা হয়নি।');
    await expect(page.getByTestId('end-unseen')).toContainText(
      'চেম্বার শেষ করলে এই সেশনে আর কোনো কাজ করা যাবে না।',
    );
    // Not until the tick.
    await expect(page.getByTestId('end-confirm')).toBeDisabled();

    // Going back ends nothing, and the tick is asked for again next time.
    await page.getByTestId('end-keep').click();
    await expect(page.getByTestId('end-chamber-sheet')).toBeHidden();
    expect((await chamberRecord(demo.sessionId)).status).toBe('running');

    await page.getByTestId('end-chamber').click();
    await expect(page.getByTestId('end-acknowledge')).not.toBeChecked();
    await expect(page.getByTestId('end-confirm')).toBeDisabled();
    await page.getByTestId('end-acknowledge').check();
    await page.getByTestId('end-confirm').click();
    await expect(page.getByTestId('ended-banner')).toBeVisible();

    // Three people were never seen. Ending did not mark them absent,
    // cancelled or seen to tidy the chamber up: each is exactly what it was.
    const after = await chamberRecord(demo.sessionId);
    expect(after.status).toBe('ended');
    expect(after.bookings).toEqual(before.bookings);
    expect(after.bookings.filter((status) => status === 'done')).toHaveLength(1);
    expect(after.bookings.filter((status) => status !== 'done')).toHaveLength(3);
    expect((await eventTypes(demo.sessionId)).at(-1)).toBe('SESSION_ENDED');
  });
});

test.describe("yesterday's chamber and today's (S-B-01, FR-QUE-06)", () => {
  test("yesterday's is told apart on the picker and ended; today's is untouched, and is then chosen and worked", async ({
    page,
  }) => {
    // The same doctor, two days: a chamber left open overnight, and today's.
    // Each in a room of its own so the picker lists it (the fixture's usual
    // room is left out of that list).
    const tag = randomUUID().slice(0, 6).toUpperCase();
    const yesterday = await createConsoleSession(2, 'in-chamber', {
      room: `Y-${tag}`,
      day: 'yesterday',
    });
    onPicker.push(yesterday.sessionId);
    const today = await createConsoleSession(3, 'in-chamber', { room: `T-${tag}` });
    onPicker.push(today.sessionId);

    // Yesterday's last patient was finished; one never came in.
    await queueAction(yesterday, `/bookings/${bookingAt(yesterday, 1)}/done`);
    const todayBefore = await chamberRecord(today.sessionId);
    const todayEventsBefore = await eventTypes(today.sessionId);
    expect(todayBefore.sessionDate).not.toBe((await chamberRecord(yesterday.sessionId)).sessionDate);

    // --- the picker says which day each chamber is from ---------------------
    await page.goto(CONSOLE);
    await page.getByTestId(`pick-hospital-${today.hospitalId}`).click();

    await expect(page.getByTestId(`chamber-card-${yesterday.sessionId}`)).toHaveAttribute(
      'data-today',
      'false',
    );
    await expect(page.getByTestId(`chamber-when-${yesterday.sessionId}`)).toContainText(
      'আগের দিনের চেম্বার',
    );
    await expect(page.getByTestId(`chamber-card-${today.sessionId}`)).toHaveAttribute(
      'data-today',
      'true',
    );
    await expect(page.getByTestId(`chamber-when-${today.sessionId}`)).toContainText('আজ');

    // --- yesterday's is opened and ended ------------------------------------
    await page.getByTestId(`open-receptionist-${yesterday.sessionId}`).click();
    await expect(page.getByTestId('queue-table')).toBeVisible();
    await expect(page.getByTestId('offline-block')).toHaveAttribute('data-connected', 'true', {
      timeout: 15_000,
    });

    await page.getByTestId('end-chamber').click();
    await expect(page.getByTestId('end-unseen')).toHaveAttribute('data-unseen', '1');
    await page.getByTestId('end-acknowledge').check();
    await page.getByTestId('end-confirm').click();
    await expect(page.getByTestId('ended-banner')).toBeVisible();

    // --- it has left the list; today's is there, exactly as it was ----------
    await page.getByTestId('back-to-chambers').click();
    await page.getByTestId(`pick-hospital-${today.hospitalId}`).click();
    await expect(page.getByTestId(`chamber-card-${today.sessionId}`)).toBeVisible();
    await expect(page.getByTestId(`chamber-card-${yesterday.sessionId}`)).toHaveCount(0);

    expect(await chamberRecord(today.sessionId)).toEqual(todayBefore);
    expect(await eventTypes(today.sessionId)).toEqual(todayEventsBefore);

    // Yesterday's is ended and its record is whole: one seen, one not.
    const ended = await chamberRecord(yesterday.sessionId);
    expect(ended.status).toBe('ended');
    expect(ended.bookings).toHaveLength(2);
    expect(ended.bookings[0]).toBe('done');
    expect(ended.bookings[1]).not.toBe('done');

    // --- and today's chamber is chosen and worked ---------------------------
    await page.getByTestId(`open-receptionist-${today.sessionId}`).click();
    await expect(page.getByTestId('queue-table')).toBeVisible();
    await expect(page.getByTestId('now-serving')).toHaveText('১');
    await page.getByTestId('call-next').click();
    await expect(page.getByTestId('now-serving')).toHaveText('২');
    await expect
      .poll(async () => (await eventTypes(today.sessionId)).slice(-2))
      .toEqual(['PATIENT_DONE', 'PATIENT_CALLED']);
  });
});
