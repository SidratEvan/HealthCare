/**
 * `e2e/demo-label.spec.ts` — a demonstration says it is one, and nothing else
 * does (`FR-DEM-07`).
 *
 * Every console screen and four of the patient's used to print "This is a
 * demonstration. All data here is for display only" whatever they were
 * running against. On a hospital's own server that is false, and false in the
 * direction that does harm: it tells the person at the counter that the
 * patient they are registering does not count.
 *
 * So the line follows what the server says about itself. This file is the
 * demonstration's half: it is there, and it is not there before the server
 * has answered. The other half — a real server never shows it — is in
 * `e2e/production/`, where there is a real server to ask.
 */

import { expect, test, type Page } from '@playwright/test';

import { createConsoleSession, type ConsoleSession } from './support/console.js';
import { putReceptionistInTab } from './support/consoleSession.js';

const CONSOLE = 'http://localhost:3100';
const PATIENT = 'http://localhost:3000';

/** The start of `demoBanner`. */
const LINE = 'এটি একটি ডেমো';

let demo: ConsoleSession;

test.beforeEach(async () => {
  demo = await createConsoleSession(3);
});

async function openQueue(page: Page): Promise<void> {
  await putReceptionistInTab(page, demo);
  await page.goto(`${CONSOLE}/?session=${demo.sessionId}`);
  await expect(page.getByTestId('queue-table')).toBeVisible();
}

test.describe('on a demonstration, the screens say so (FR-DEM-07)', () => {
  test('the reception queue carries the line', async ({ page }) => {
    await openQueue(page);
    await expect(page.getByTestId('demo-banner')).toBeVisible();
    await expect(page.getByTestId('demo-banner')).toContainText(LINE);
  });

  test('the registration desk carries the line', async ({ page }) => {
    // The desk opens for a receptionist, so the tab says that is who it is —
    // the store the picker writes, with the role it would have written.
    await page.addInitScript(
      ([token, hospitalId]) => {
        window.sessionStorage.setItem(
          'console.demo-session',
          JSON.stringify({ token, hospitalId, staffName: 'E2E', role: 'receptionist' }),
        );
      },
      [demo.token, demo.hospitalId],
    );
    await page.goto(`${CONSOLE}/?view=registration`);
    await expect(page.getByTestId('registration-console')).toBeVisible();
    await expect(page.getByTestId('demo-banner')).toContainText(LINE);
  });

  test('the patient app carries it on its home screen and on the booking flow', async ({
    page,
  }) => {
    await page.goto(PATIENT);
    await expect(page.getByTestId('emergency-card')).toBeVisible();
    await expect(page.getByTestId('demo-banner')).toContainText(LINE);

    await page.goto(`${PATIENT}/book?specialty=${demo.departmentCode}`);
    await expect(page.getByTestId('demo-banner')).toContainText(LINE);
  });
});

test.describe('until the server has said what it is, nothing claims to be a demonstration', () => {
  /**
   * The mistake that matters is a real queue carrying the line, so an
   * unanswered question is treated as "not known", never as "yes". Here the
   * answer is held back for good, which is the longest "not yet" there is.
   */
  test('the reception queue is drawn without the line', async ({ page }) => {
    await page.route('**/api/v1/demo/status', () => {
      // Never answered.
    });

    await openQueue(page);
    await expect(page.getByTestId('offline-block')).toHaveAttribute('data-connected', 'true', {
      timeout: 15_000,
    });
    await expect(page.getByTestId('demo-banner')).toHaveCount(0);
    await expect(page.getByText(LINE, { exact: false })).toHaveCount(0);
  });

  test('the patient app is drawn without the line', async ({ page }) => {
    await page.route('**/api/v1/config', () => {
      // Never answered.
    });

    await page.goto(PATIENT);
    await expect(page.getByTestId('emergency-card')).toBeVisible();
    await expect(page.getByTestId('specialty-CARD')).toBeVisible();
    await expect(page.getByTestId('demo-banner')).toHaveCount(0);
    await expect(page.getByText(LINE, { exact: false })).toHaveCount(0);
  });
});
