/**
 * `e2e/console-undo.spec.ts` — the console's Undo undoes (`GR-02`,
 * `FR-REC-16`).
 *
 * The handover audit of 2 October found the toast's Undo sending a *booking*
 * id where an event id belongs: nothing was undone, and a useless
 * `ACTION_UNDONE` was left in a log that can never be cleaned. No test pressed
 * the button. These press it, on the real API, and check both what the screens
 * show and what the log holds.
 */

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import {
  createConsoleSession,
  eventCount,
  eventTypes,
  undoneTypes,
  type ConsoleSession,
} from './support/console.js';
import { putReceptionistInTab } from './support/consoleSession.js';
import { openLiveSerial, trackingLinkOn } from './support/patient.js';

let demo: ConsoleSession;

test.beforeEach(async () => {
  // Its own session: `queue_events` is append-only (CLAUDE.md §6).
  demo = await createConsoleSession(8);
});

async function openConsole(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();

  // The same store `ConsolePicker` writes (CLAUDE.md §4.1).
  await putReceptionistInTab(page, demo);

  await page.goto(`http://localhost:3100/?session=${demo.sessionId}`);
  await expect(page.getByTestId('queue-table')).toBeVisible();
  return page;
}

const UNDO = 'ফিরিয়ে নিন';
const UNDONE = 'ফিরিয়ে নেওয়া হয়েছে';

test.describe('undoing a queue action (GR-02)', () => {
  test('Undo after "next" puts both patients back, on the counter and in the corridor', async ({
    browser,
  }) => {
    const counter = await browser.newContext();
    const corridor = await browser.newContext();

    try {
      const bookingPage = await corridor.newPage();
      const trackingUrl = await trackingLinkOn(bookingPage, demo);
      await bookingPage.close();

      const patient = await openLiveSerial(corridor, trackingUrl);
      const console_ = await openConsole(counter);
      const before = await eventTypes(demo.sessionId);

      // Serial 1 finishes, serial 2 is called.
      await console_.getByTestId('call-next').click();
      await expect(console_.getByTestId('now-serving')).toHaveText('২');
      await expect(patient.getByTestId('now-serving')).toHaveText('২');

      // A slip: the patient in the chamber had not finished.
      await console_.getByRole('button', { name: UNDO }).click();

      // The whole tap is taken back: serial 1 is in the chamber again and
      // serial 2 is waiting, where everybody can see it.
      await expect(console_.getByTestId('now-serving')).toHaveText('১');
      await expect(console_.getByTestId('queue-row-1')).toHaveAttribute(
        'data-status',
        'in_chamber',
      );
      await expect(console_.getByTestId('queue-row-2')).toHaveAttribute('data-status', 'booked');
      await expect(patient.getByTestId('now-serving')).toHaveText('১');
      await expect(console_.getByText(UNDONE).first()).toBeVisible();

      // History is never deleted: both events stay, each with the undo that
      // compensated it — the call first, then the finish.
      expect((await eventTypes(demo.sessionId)).slice(before.length)).toEqual([
        'PATIENT_DONE',
        'PATIENT_CALLED',
        'ACTION_UNDONE',
        'ACTION_UNDONE',
      ]);
      expect(await undoneTypes(demo.sessionId)).toEqual(['PATIENT_DONE', 'PATIENT_CALLED']);

      // And the chamber carries on from where it truly was.
      await console_.getByTestId('call-next').click();
      await expect(patient.getByTestId('now-serving')).toHaveText('২');
    } finally {
      await counter.close();
      await corridor.close();
    }
  });

  test('Ctrl+Z takes back the last action, once (APP_FLOW.md §13)', async ({ browser }) => {
    const counter = await browser.newContext();

    try {
      const console_ = await openConsole(counter);
      const row = console_.getByTestId('queue-row-3');
      await expect(row).toHaveAttribute('data-status', 'booked');

      // The wrong row: serial 3 is marked late and moves down the queue.
      await row.getByRole('button', { name: 'দেরি' }).click();
      await expect(row).toHaveAttribute('data-status', 'late');
      await expect.poll(async () => (await eventTypes(demo.sessionId)).at(-1)).toBe('PATIENT_LATE');

      await console_.keyboard.press('Control+z');

      await expect(row).toHaveAttribute('data-status', 'booked');
      await expect(console_.getByText(UNDONE).first()).toBeVisible();
      expect(await undoneTypes(demo.sessionId)).toEqual(['PATIENT_LATE']);

      // Only the last action: a second press does not reach further back.
      const settled = await eventCount(demo.sessionId);
      await console_.keyboard.press('Control+z');
      await expect(console_.getByText('ফিরিয়ে নেওয়ার মতো কিছু নেই।').first()).toBeVisible();
      expect(await eventCount(demo.sessionId)).toBe(settled);
    } finally {
      await counter.close();
    }
  });

  test('an action undone before it was sent is never sent (FR-OFF-01)', async ({ browser }) => {
    const counter = await browser.newContext();

    try {
      const console_ = await openConsole(counter);
      const before = await eventCount(demo.sessionId);

      await counter.setOffline(true);
      await expect(console_.getByTestId('offline-block')).toHaveAttribute(
        'data-connected',
        'false',
        { timeout: 20_000 },
      );

      // Taken on a dead network: applied on screen, waiting to go.
      await console_.getByTestId('call-next').click();
      await expect(console_.getByTestId('now-serving')).toHaveText('২');
      await expect(console_.getByTestId('pending-count')).toBeVisible();

      await console_.getByRole('button', { name: UNDO }).click();

      // Back as it was, with nothing left to send.
      await expect(console_.getByTestId('now-serving')).toHaveText('১');
      await expect(console_.getByTestId('pending-count')).toBeHidden();

      await counter.setOffline(false);
      await expect(console_.getByTestId('offline-block')).toHaveAttribute(
        'data-connected',
        'true',
        { timeout: 30_000 },
      );

      // The server never heard of the tap or of its undo: no events at all,
      // rather than a call and a compensation for something nobody saw.
      await expect(console_.getByTestId('now-serving')).toHaveText('১');
      expect(await eventCount(demo.sessionId)).toBe(before);
    } finally {
      await counter.close();
    }
  });
});
