/**
 * `e2e/staff-login.spec.ts` — staff sign-in (pilot step 21, `S-B-00`,
 * `S-B-00c`, FR-SEC-06).
 *
 * Through the browser, the way a receptionist meets it: the demo picker's link
 * to sign in, a wrong password, the right one, the picker narrowed to their own
 * facility and roles, a chamber, and signing out. A person whose password an
 * administrator set replaces it before any console opens. A session the server
 * stops accepting comes back to the sign-in screen and says why.
 *
 * Jamuna — the government college — because its chambers sit every day of the
 * week, Friday included (`seed_02`, `FRIDAY_CHAMBERS`), so the chamber this
 * spec opens exists whatever day it runs.
 */

import { expect, test, type Page } from '@playwright/test';

import { DEMO_PASSWORD, seededReceptionist, staffWithTemporaryPassword } from './support/staff.js';

const CONSOLE = 'http://localhost:3100';
const FACILITY = 'JAMUNA';
const STORAGE_KEY = 'console.demo-session';

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
}

test.describe('staff sign-in (S-B-00)', () => {
  test('a person signs in with their own account and sees only their own facility', async ({
    page,
  }) => {
    const reception = await seededReceptionist(FACILITY);

    await page.goto(CONSOLE);
    await expect(page.getByTestId('console-picker')).toBeVisible();
    await page.getByTestId('picker-login-link').click();
    await expect(page.getByTestId('staff-login')).toBeVisible();
    await expect(page.getByTestId('login-demo-note')).toContainText(DEMO_PASSWORD);

    // One message for a wrong password, whichever part was wrong.
    await signIn(page, reception.email, 'not-the-password');
    await expect(page.getByTestId('login-error')).toContainText('ইমেইল বা পাসওয়ার্ড মেলেনি');

    await signIn(page, reception.email, DEMO_PASSWORD);
    await expect(page.getByTestId('console-picker')).toBeVisible();
    await expect(page.getByTestId('picker-signed-in')).toBeVisible();
    // No hospital to choose: the person works at one.
    await expect(page.locator('[data-testid^="pick-hospital-"]')).toHaveCount(0);

    // A receptionist is offered reception on each chamber, and nothing else.
    const open = page.locator('[data-testid^="open-receptionist-"]').first();
    await expect(open).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid^="open-doctor-"]')).toHaveCount(0);
    await open.click();
    await expect(page.getByTestId('chamber-title')).toBeVisible();

    await page.getByTestId('rail-sign-out').click();
    await expect(page.getByTestId('console-picker')).toBeVisible();
    await expect(page.getByTestId('picker-login-link')).toBeVisible();
  });

  test('a password an administrator set is replaced before any console opens (S-B-00c)', async ({
    page,
  }) => {
    const temporary = 'temporary-pass-1';
    const own = 'my-own-password-99';
    const staff = await staffWithTemporaryPassword(FACILITY, temporary);

    await page.goto(`${CONSOLE}/?login=1`);
    await signIn(page, staff.email, temporary);
    await expect(page.getByTestId('change-password')).toBeVisible();

    await page.getByTestId('password-current').fill(temporary);
    await page.getByTestId('password-new').fill(own);
    await page.getByTestId('password-repeat').fill('something-else-1');
    await expect(page.getByText('দুটি নতুন পাসওয়ার্ড মেলেনি।')).toBeVisible();
    await expect(page.getByTestId('password-submit')).toHaveAttribute('aria-disabled', 'true');

    await page.getByTestId('password-repeat').fill(own);
    await page.getByTestId('password-submit').click();
    await expect(page.getByTestId('console-picker')).toBeVisible();
    await expect(page.getByTestId('picker-signed-in')).toBeVisible();

    // The temporary password no longer opens anything; the person's own does.
    await page.getByTestId('picker-sign-out').click();
    // Signing out returns to the demo picker; wait for it, so the next
    // navigation does not race the one signing out started.
    await expect(page.getByTestId('picker-login-link')).toBeVisible();
    await page.goto(`${CONSOLE}/?login=1`);
    await signIn(page, staff.email, temporary);
    await expect(page.getByTestId('login-error')).toBeVisible();
    await signIn(page, staff.email, own);
    await expect(page.getByTestId('console-picker')).toBeVisible();
  });

  test('a session the server stops accepting returns to sign-in and says why', async ({ page }) => {
    const reception = await seededReceptionist(FACILITY);
    await page.goto(`${CONSOLE}/?login=1`);
    await signIn(page, reception.email, DEMO_PASSWORD);
    await expect(page.getByTestId('console-picker')).toBeVisible();

    // The access token is due and the refresh token is one the server never
    // issued — what a revoked session looks like from this side.
    await page.evaluate((key) => {
      const raw = sessionStorage.getItem(key);
      if (raw === null) throw new Error('no session stored');
      const session = JSON.parse(raw) as Record<string, unknown>;
      session['accessExpiresAt'] = new Date(Date.now() - 1_000).toISOString();
      session['refresh'] = `${crypto.randomUUID()}.${'x'.repeat(43)}`;
      sessionStorage.setItem(key, JSON.stringify(session));
    }, STORAGE_KEY);
    await page.reload();

    await expect(page.getByTestId('staff-login')).toBeVisible();
    await expect(page.getByTestId('login-ended')).toBeVisible();
  });
});
