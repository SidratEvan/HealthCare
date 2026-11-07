/**
 * `e2e/token-slip.spec.ts` — the counter prints a token slip, and the QR code
 * on it opens the patient's live serial (`FR-REC-21`, `BTN-B02-SLIP`,
 * `FR-GST-05`).
 *
 * The pilot has no SMS, so a walk-in leaves the counter with this paper and
 * nothing else. The browser's print is replaced with a recorder: what would go
 * to paper is the slip, alone, and it is taken away after printing.
 */

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { createConsoleSession } from './support/console.js';
import { closeOtherContexts } from './support/contexts.js';
import { receptionFixture } from './support/reception.js';
import { DEMO_PASSWORD } from './support/staff.js';

const CONSOLE = 'http://localhost:3100';

interface Printed {
  readonly text: string;
  readonly serial: string;
  readonly qr: boolean;
  readonly alone: boolean;
}

/** Each `print()` records the slip on the page at that moment, then ends. */
async function recordPrints(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const prints: unknown[] = [];
    (globalThis as unknown as { __prints: unknown[] }).__prints = prints;
    globalThis.print = () => {
      const slip = document.querySelector('[data-token-slip]');
      prints.push({
        text: slip?.textContent ?? '',
        serial: slip?.querySelector('[data-testid="token-slip-serial"]')?.textContent ?? '',
        qr: slip?.querySelector('img[data-testid="token-slip-qr"]') !== null,
        alone:
          slip?.parentElement === document.body &&
          document.documentElement.hasAttribute('data-printing'),
      });
      globalThis.dispatchEvent(new Event('afterprint'));
    };
  });
}

async function printed(page: Page): Promise<Printed> {
  await expect
    .poll(() =>
      page.evaluate(() => (globalThis as unknown as { __prints: unknown[] }).__prints.length),
    )
    .toBe(1);
  return (await page.evaluate(
    () => (globalThis as unknown as { __prints: unknown[] }).__prints[0],
  )) as Printed;
}

test.afterEach(async ({ browser, context }) => {
  await closeOtherContexts(browser, context);
});

test('a walk-in leaves registration with a slip whose QR opens their live serial', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const fixture = await receptionFixture(1);
  const chamber = fixture.sessions[0]!;
  await recordPrints(page);

  await page.goto(`${CONSOLE}/?login=1`);
  await page.getByTestId('login-email').fill(fixture.staff.email);
  await page.getByTestId('login-password').fill(DEMO_PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('reception-workspace')).toBeVisible();
  await page.goto(`${CONSOLE}/?view=registration`);
  await expect(page.getByTestId(`registration-add-${chamber.sessionId}`)).toBeVisible();

  const phone = `019${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`;
  await page.getByTestId('finder-phone').fill(phone);
  await expect(page.getByTestId('finder-name')).toBeVisible();
  await page.getByTestId('finder-name').fill('Slip patient (Demo)');
  await page.getByTestId('finder-age').fill('৩৪');
  await page.getByRole('button', { name: /^(পুরুষ|Male)$/ }).click();
  await page.getByTestId('finder-register').click();
  await expect(page.getByTestId('registration-chosen')).toBeVisible();
  await page.getByTestId(`registration-add-${chamber.sessionId}`).click();
  await page.getByTestId('registration-submit').click();
  await expect(page.getByTestId('registration-serial')).toHaveText('৫');

  const answer = page.waitForResponse(
    (response) => response.url().endsWith('/slip') && response.request().method() === 'POST',
  );
  await page.getByTestId('registration-print-slip').click();
  const slip = (await (await answer).json()) as { data: { trackingUrl: string } };

  const paper = await printed(page);
  expect(paper.serial).toBe('৫');
  expect(paper.alone).toBe(true);
  expect(paper.qr).toBe(true);
  expect(paper.text).toContain('আনুমানিক সময়');
  expect(paper.text).toContain('ছাপা হয়েছে');
  // Patient-facing paper is Bangla digits, whatever the screen is in.
  expect(paper.text).not.toMatch(/[0-9]/u);
  // Taken away once printed: never left on the page behind the console.
  await expect(page.locator('[data-token-slip]')).toHaveCount(0);

  // The patient scans the code on their own phone, with no account.
  const phoneContext: BrowserContext = await browser.newContext();
  const patient = await phoneContext.newPage();
  await patient.goto(slip.data.trackingUrl);
  await expect(patient.getByTestId('live-serial-number')).toHaveText('৫');
});

test('reception prints a waiting patient’s slip from the row', async ({ page }) => {
  const demo = await createConsoleSession(6);
  await recordPrints(page);
  await page.addInitScript((token: string) => {
    window.sessionStorage.setItem(
      'console.demo-session',
      JSON.stringify({ token, hospitalId: 'e2e', staffName: 'E2E', role: 'receptionist' }),
    );
  }, demo.token);
  await page.goto(`${CONSOLE}/?session=${demo.sessionId}`);
  await expect(page.getByTestId('queue-table')).toBeVisible();

  await page.getByTestId('row-more-4').click();
  await page.getByTestId('print-slip-4').click();

  const paper = await printed(page);
  expect(paper.serial).toBe('৪');
  expect(paper.alone).toBe(true);
  expect(paper.text).toContain('আনুমানিক সময়');
});
