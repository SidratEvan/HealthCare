/**
 * `e2e/built/console-offline-shell.spec.ts` — the console opens with no
 * network (`FR-OFF-01`).
 *
 * "Reception, ward, and emergency consoles are offline-first: full read and
 * write capability without internet." Until plan 1.6 the console kept working
 * through an outage only while its tab stayed open: a reload was the browser's
 * error page.
 *
 * ## Why this spec is not with the others
 *
 * It runs against the console **as built** (`playwright.built.config.ts`:
 * `next build`, then `next start`), which is what a hospital runs. It cannot
 * run against `next dev`: the development client will not start the app until
 * it has heard from its own dev server over a websocket, so an offline reload
 * there loads every cached file and then sits on a blank page. That is a
 * property of the development server, not of the console — and a test that
 * could only ever pass by not being offline would prove nothing.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  createConsoleSession,
  eventCount,
  eventTypes,
  type ConsoleSession,
} from '../support/console.js';
import { putReceptionistInTab } from '../support/consoleSession.js';

let demo: ConsoleSession;

test.beforeEach(async () => {
  // Its own session: `queue_events` is append-only (CLAUDE.md §6).
  demo = await createConsoleSession();
});

async function openConsole(page: Page): Promise<void> {
  // The same store `ConsolePicker` writes (CLAUDE.md §4.1). `sessionStorage`
  // belongs to the tab, so it is still there after a reload — which is the
  // case this covers. A browser restarted after a power cut starts signed out,
  // and signing in needs the server.
  await putReceptionistInTab(page, demo);

  await page.goto(`/?session=${demo.sessionId}`);
  await expect(page.getByTestId('queue-table')).toBeVisible();
}

test.describe('the console opens with no network (FR-OFF-01)', () => {
  test('reloads offline, shows the last queue with its age, and keeps taking actions', async ({
    page,
    context,
  }) => {
    await openConsole(page);
    await expect(page.getByTestId('now-serving')).toHaveText('১');

    // The page says when its shell is on the device. Before that a reload
    // still needs the network, as any first visit does.
    await expect(page.locator('html')).toHaveAttribute('data-offline-ready', 'true', {
      timeout: 30_000,
    });
    const before = await eventCount(demo.sessionId);

    await context.setOffline(true);
    await expect(page.getByTestId('offline-block')).toHaveAttribute('data-connected', 'false', {
      timeout: 20_000,
    });

    // The reload that used to be the browser's error page: a counter that had
    // been working through an outage had nothing left to work in.
    await page.reload();
    await expect(page.getByTestId('queue-table')).toBeVisible();

    // The queue as this device last knew it — said to be offline, and with its
    // age beside it rather than presented as current (`FR-OFF-03`).
    await expect(page.getByTestId('now-serving')).toHaveText('১');
    await expect(page.getByTestId('offline-block')).toHaveAttribute('data-connected', 'false');
    await expect(page.getByTestId('freshness')).toBeVisible();

    // And it is a console, not a picture of one.
    await page.getByTestId('call-next').click();
    await expect(page.getByTestId('now-serving')).toHaveText('২');
    await expect(page.getByTestId('pending-count')).toBeVisible();
    expect(await eventCount(demo.sessionId)).toBe(before);

    await context.setOffline(false);
    await expect(page.getByTestId('pending-count')).toBeHidden({ timeout: 45_000 });
    await expect
      .poll(async () => (await eventTypes(demo.sessionId)).slice(before))
      .toEqual(['PATIENT_DONE', 'PATIENT_CALLED']);
  });

  test('a second reload offline keeps what the first one queued', async ({ page, context }) => {
    await openConsole(page);
    await expect(page.locator('html')).toHaveAttribute('data-offline-ready', 'true', {
      timeout: 30_000,
    });
    const before = await eventCount(demo.sessionId);

    await context.setOffline(true);
    await expect(page.getByTestId('offline-block')).toHaveAttribute('data-connected', 'false', {
      timeout: 20_000,
    });

    await page.getByTestId('call-next').click();
    await expect(page.getByTestId('now-serving')).toHaveText('২');

    // The shell from the cache, the queue from what the device was last told,
    // and the tap from the outbox on disk: all three have to be there.
    await page.reload();
    await expect(page.getByTestId('queue-table')).toBeVisible();
    await expect(page.getByTestId('now-serving')).toHaveText('২');
    await expect(page.getByTestId('pending-count')).toBeVisible();
    expect(await eventCount(demo.sessionId)).toBe(before);

    await context.setOffline(false);
    await expect(page.getByTestId('pending-count')).toBeHidden({ timeout: 45_000 });
    await expect
      .poll(async () => (await eventTypes(demo.sessionId)).slice(before))
      .toEqual(['PATIENT_DONE', 'PATIENT_CALLED']);
  });

  test('a chamber this device has never opened says so, rather than loading forever', async ({
    page,
    context,
  }) => {
    await openConsole(page);
    await expect(page.locator('html')).toHaveAttribute('data-offline-ready', 'true', {
      timeout: 30_000,
    });

    // Another chamber, which this browser has never been told anything about.
    const other = await createConsoleSession();

    await context.setOffline(true);
    await expect(page.getByTestId('offline-block')).toHaveAttribute('data-connected', 'false', {
      timeout: 20_000,
    });
    await page.goto(`/?session=${other.sessionId}`);

    // The console itself opens. What it has nothing to show, it says — an
    // empty queue or an endless "loading" would both be a claim (`FR-OFF-05`).
    await expect(page.getByTestId('queue-not-kept')).toHaveText(
      'সংযোগ নেই, আর এই চেম্বারের সিরিয়াল এই ডিভাইসে রাখা নেই। সংযোগ ফিরলে নিজে থেকেই খুলবে।',
    );
    await expect(page.getByTestId('queue-table')).toHaveCount(0);

    // And it opens by itself when the connection returns.
    await context.setOffline(false);
    await expect(page.getByTestId('queue-table')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('now-serving')).toHaveText('১');
  });
});
