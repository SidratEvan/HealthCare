/**
 * `e2e/console-cold-start.spec.ts` — `S-B-01` against an API that is asleep.
 *
 * The demo API sleeps when nobody has used it and takes the better part of a
 * minute to wake. `fetch` has no timeout of its own, so before this the picker
 * sat on its loading skeleton for as long as the page stayed open: the one
 * `GR-03` state with no way out, because nothing ever rejected.
 *
 * It is worth an end-to-end test rather than a unit one because the failure was
 * never in the logic — every branch of that component was already correct. It
 * was in what `fetch` does when a host accepts a connection and then says
 * nothing, and only a real browser does that.
 */

import { expect, test, type Page } from '@playwright/test';

const CONSOLE = 'http://localhost:3100';

/**
 * Holds the *first* `/demo/consoles` open without answering, then serves the
 * rest normally — which is what a booting API does.
 *
 * Delaying every attempt would model a dead host instead of a sleeping one, and
 * no number of retries can recover from that. The point of the retry is that
 * the service is coming up while the first request is in flight.
 */
async function hangFirstCalls(page: Page, calls: number, forMs: number): Promise<void> {
  let seen = 0;

  await page.route('**/demo/consoles', async (route) => {
    seen += 1;
    if (seen <= calls) await new Promise((resolve) => setTimeout(resolve, forMs));
    await route.continue();
  });
}

test.describe('S-B-01 when the API is waking', () => {
  /**
   * Longer than the suite's 60 s default, because the behaviour under test is
   * itself slow: four attempts at twelve seconds each is forty-eight seconds
   * before the screen is allowed to give up. Stating the real budget is better
   * than trimming the retry to suit the clock — the retry length is a product
   * decision about a sleeping API, not a test detail.
   */
  test.setTimeout(120_000);

  test('says the server is waking instead of showing a skeleton forever', async ({ page }) => {
    // Three slow attempts, so the waking state is on screen for a wide window
    // rather than flashing between one attempt timing out and the next
    // succeeding. The fourth is served normally, so the screen still recovers.
    await hangFirstCalls(page, 3, 14_000);
    await page.goto(CONSOLE);

    // Generous, because the first test in this file also pays for the dev
    // server compiling the page, which shifts every timing below it.
    await expect(page.getByTestId('picker-waking')).toBeVisible({ timeout: 60_000 });

    // The honest intermediate state: still loading, and saying why.
    await expect(page.getByTestId('picker-loading')).toBeVisible();
  });

  test('recovers on a later attempt and opens normally', async ({ page }) => {
    await hangFirstCalls(page, 1, 14_000);
    await page.goto(CONSOLE);

    // Giving up after one attempt would make the console unopenable exactly
    // when somebody opens it for the first time — which is every demo.
    await expect(page.getByTestId('picker-loading')).toHaveCount(0, { timeout: 45_000 });
    await expect(page.getByTestId('picker-waking')).toHaveCount(0);
    await expect(page.locator('[data-testid^="pick-hospital-"]').first()).toBeVisible();
  });

  test('gives up eventually, and offers a way out (GR-03)', async ({ page }) => {
    // Never answers. Four attempts at twelve seconds each, then the screen has
    // to say something rather than wait forever.
    await page.route('**/demo/consoles', async () => {
      await new Promise(() => {
        // Deliberately never settles.
      });
    });

    await page.goto(CONSOLE);

    await expect(page.getByTestId('picker-failed')).toBeVisible({ timeout: 70_000 });
    await expect(page.getByRole('button', { name: 'আবার চেষ্টা করুন' })).toBeVisible();
  });
});
