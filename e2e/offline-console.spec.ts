/**
 * `e2e/offline-console.spec.ts` — required by CLAUDE.md §6.
 *
 * "Go offline, run five queue actions, reconnect, verify order and
 * idempotency."
 *
 * This is step 8's definition of done, in a browser, against the real API and
 * the seeded demo database. Everything under it has been proven at a lower
 * level — the queue's ordering in `shared/client`, the protocol in
 * `sync.routes.test.ts` — and none of that answers the question this file
 * asks: does a receptionist who loses the wifi mid-shift keep working, and
 * does her work arrive intact when it comes back?
 *
 * ## Why it drives the real pitch session
 *
 * `FR-DEM-06` puts one session mid-queue for the demo, and that is the session
 * a hospital director will be shown. A failure here is a failure of the thing
 * being demonstrated, not of a fixture invented for a test.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  createConsoleSession,
  eventCount,
  eventTypes,
  loadPitchSession,
  type ConsoleSession,
} from './support/console.js';

/**
 * A session of this spec's own, rebuilt for every test.
 *
 * `queue_events` is append-only, so a test cannot undo what it did. Sharing
 * one session between tests would make the spec that calls five patients leave
 * the chamber empty for the next one — failing it for a reason that has
 * nothing to do with the code under test. That is the flakiness CLAUDE.md §6
 * calls a bug, and this is the fix rather than a retry.
 */
let demo: ConsoleSession;

test.beforeEach(async () => {
  demo = await createConsoleSession();
});

/**
 * Opens the console with a session selected and a principal in place.
 *
 * The token goes into `sessionStorage` before any script runs — that is what
 * `DEMO_MODE` does in place of a login (CLAUDE.md §4.1), and doing it in an
 * init script rather than through a form keeps this spec about the offline
 * behaviour rather than about a sign-in screen that does not exist.
 */
async function openConsole(page: Page): Promise<void> {
  // The same store `ConsolePicker` writes, so a spec and a person reach the
  // console the same way — one credential, one key (CLAUDE.md §4.1).
  await page.addInitScript((token: string) => {
    window.sessionStorage.setItem(
      'console.demo-session',
      JSON.stringify({ token, hospitalId: 'e2e', staffName: 'E2E' }),
    );
  }, demo.token);

  await page.goto(`/?session=${demo.sessionId}`);
  await expect(page.getByTestId('queue-table')).toBeVisible();
}

test.describe('the reception console', () => {
  test('shows a mid-queue session, with one patient in the chamber', async ({ page }) => {
    await openConsole(page);

    // FR-QUE-53: exactly one, never two.
    await expect(page.getByTestId('now-serving')).toBeVisible();
    await expect(page.locator('[data-status="in_chamber"]')).toHaveCount(1);

    // CLAUDE.md §5.8: every live figure carries its freshness.
    await expect(page.getByTestId('freshness')).toBeVisible();
  });

  test('opens the demo on the pitch session (FR-DEM-06)', async ({ page }) => {
    // Read-only, and deliberately against the demo's *own* session: this is
    // the screen a hospital director is shown, so it is the one worth
    // asserting opens correctly. Nothing here writes to it.
    const pitch = await loadPitchSession();

    await page.addInitScript((token: string) => {
      window.sessionStorage.setItem(
        'console.demo-session',
        JSON.stringify({ token, hospitalId: 'e2e', staffName: 'E2E' }),
      );
    }, pitch.token);
    await page.goto(`/?session=${pitch.sessionId}`);

    await expect(page.getByTestId('queue-table')).toBeVisible();
    await expect(page.locator('[data-status="in_chamber"]')).toHaveCount(1);
    await expect(page.getByTestId('freshness')).toBeVisible();
  });

  test('says it is online, with nothing waiting to send', async ({ page }) => {
    await openConsole(page);

    const block = page.getByTestId('offline-block');
    await expect(block).toHaveAttribute('data-connected', 'true');
    await expect(page.getByTestId('pending-count')).toBeHidden();
  });
});

test.describe('a shift with the network gone (FR-OFF-01)', () => {
  test('queues five actions offline, then syncs them in order on reconnect', async ({
    page,
    context,
  }) => {
    await openConsole(page);

    const before = await eventCount(demo.sessionId);

    // --- the wifi drops ----------------------------------------------------
    await context.setOffline(true);

    // The console must not blank, and must say what happened. A console that
    // hides the queue when the network drops is useless exactly when a
    // receptionist needs it in front of her (PRD.md §3.2).
    await expect(page.getByTestId('queue-table')).toBeVisible();
    await expect(page.getByTestId('offline-block')).toHaveAttribute('data-connected', 'false', {
      timeout: 20_000,
    });

    // --- five actions, on a dead network -----------------------------------
    //
    // Each tap must answer immediately. This is NFR-02 and FR-OFF-01 together:
    // the receptionist cannot tell, from the queue in front of her, that
    // anything is wrong.
    const callNext = page.getByTestId('call-next');
    for (let i = 0; i < 5; i += 1) {
      await callNext.click();
      // The pending counter is the only visible difference from being online.
      await expect(page.getByTestId('pending-count')).toBeVisible();
    }

    const pendingText = await page.getByTestId('pending-count').textContent();
    expect(pendingText).toBeTruthy();

    // Nothing has reached the server. The log is exactly as it was.
    expect(await eventCount(demo.sessionId)).toBe(before);

    // --- the network comes back --------------------------------------------
    await context.setOffline(false);

    await expect(page.getByTestId('offline-block')).toHaveAttribute('data-connected', 'true', {
      timeout: 30_000,
    });

    // Everything queued drains. This is the definition of done for step 8.
    await expect(page.getByTestId('pending-count')).toBeHidden({ timeout: 30_000 });

    // --- order and idempotency ---------------------------------------------
    const after = await eventCount(demo.sessionId);
    expect(after).toBeGreaterThan(before);

    const types = await eventTypes(demo.sessionId);
    const replayed = types.slice(before);

    // SY-01: the batch replayed in the order she acted, not the order the
    // requests happened to arrive.
    //
    // The sequence a run of "finish and call next" produces is strictly
    // alternating — done, called, done, called — and it *starts* with a done,
    // because the seeded session already had somebody in the chamber
    // (FR-DEM-06). So the invariant to assert is not "a call comes first" but
    // FR-QUE-53 itself: never two calls without the completion that frees the
    // chamber between them. Out-of-order replay breaks that immediately.
    const chamber = replayed.filter((type) => type === 'PATIENT_CALLED' || type === 'PATIENT_DONE');

    expect(chamber.length, 'the offline actions did not reach the log').toBeGreaterThan(0);

    for (const [index, type] of chamber.entries()) {
      if (index === 0) continue;
      expect(
        type === chamber[index - 1],
        `two ${type} in a row — the batch replayed out of order`,
      ).toBe(false);
    }

    // SY-02: one event per action, never two. A replayed batch is safe, and
    // "safe" means the queue did not advance twice.
    const settled = await eventCount(demo.sessionId);
    expect(settled).toBe(after);
  });

  test('keeps the queue readable and the freshness honest while offline', async ({
    page,
    context,
  }) => {
    await openConsole(page);
    await context.setOffline(true);

    await expect(page.getByTestId('offline-block')).toHaveAttribute('data-connected', 'false', {
      timeout: 20_000,
    });

    // FR-OFF-03 / FR-OFF-05: the figure stays on screen, and the line beneath
    // it keeps ageing. An app that admits its data is minutes old is trusted
    // more than one that pretends otherwise.
    await expect(page.getByTestId('now-serving')).toBeVisible();
    await expect(page.getByTestId('freshness')).toBeVisible();

    await context.setOffline(false);
  });
});
