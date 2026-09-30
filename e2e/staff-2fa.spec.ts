/**
 * `e2e/staff-2fa.spec.ts` — two-step verification for staff (pilot step 28,
 * `S-B-00b`, `S-B-00d`, `FR-SEC-10`, `FR-SEC-06`).
 *
 * The step's test of done: **an administrator cannot sign in without the
 * second factor.** Through the browser: the first sign-in on a password
 * reaches the setup and nothing else, whatever the URL says, and the server
 * refuses the token everywhere but there; once it is on, a password is half a
 * sign-in and the code from the app is the other half. A lost phone is a
 * recovery code, or an administrator's reset from `S-B-11`.
 *
 * On a facility made for the spec (`support/facility.ts`), as the settings
 * spec does, so no seeded administrator is left with a second factor another
 * spec would meet.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  addStaffMember,
  newFacility,
  removeFacility,
  type NewFacility,
} from './support/facility.js';
import { completeSetup, enrolmentOf, enterCode, passSecondFactor } from './support/twoFactor.js';

const CONSOLE = 'http://localhost:3100';
const API = 'http://localhost:4000/api/v1';
const PASSWORD = 'two-step-e2e-password';
const STORAGE_KEY = 'console.demo-session';

const made: NewFacility[] = [];

test.afterAll(async () => {
  for (const facility of made) await removeFacility(facility.hospitalId);
});

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto(`${CONSOLE}/?login=1`);
  await expect(page.getByTestId('staff-login')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
}

async function signOut(page: Page): Promise<void> {
  await page.getByTestId('picker-sign-out').click();
  await expect(page.getByTestId('picker-login-link')).toBeVisible({ timeout: 30_000 });
}

test.describe('an administrator cannot sign in without the second factor (FR-SEC-10)', () => {
  test.setTimeout(180_000);

  test('a password alone reaches the setup and nothing else; after it, every sign-in asks for the code', async ({
    page,
  }) => {
    const facility = await newFacility(PASSWORD);
    made.push(facility);

    await signIn(page, facility.adminEmail);
    const setup = page.getByTestId('two-factor-setup');
    await expect(setup).toBeVisible({ timeout: 30_000 });
    // No "not now" for an administrator, and the dashboard by its URL is the
    // same screen.
    await expect(page.getByTestId('tfa-setup-cancel')).toHaveCount(0);
    await page.goto(`${CONSOLE}/?view=admin`);
    await expect(setup).toBeVisible({ timeout: 30_000 });

    // The server's rule, not only the screen's: the token this tab holds is
    // refused by the facility's own settings.
    const token = await page.evaluate(
      (key) =>
        (JSON.parse(globalThis.sessionStorage.getItem(key) ?? '{}') as { token: string }).token,
      STORAGE_KEY,
    );
    const refused = await page.request.get(`${API}/hospital/setup`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(refused.status()).toBe(403);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      'AUTH_2FA_SETUP_REQUIRED',
    );

    // The QR code is drawn in the page, with the key beside it for typing.
    await expect(page.getByTestId('tfa-qr')).toBeVisible();
    await page.getByTestId('tfa-setup-code').fill('000000');
    await page.getByTestId('tfa-setup-submit').click();
    await expect(page.getByText('কোডটি মেলেনি।', { exact: false })).toBeVisible();

    // The right code turns it on; ten recovery codes, and the console only
    // once the person says they have kept them.
    await completeSetup(page, facility.adminEmail);
    // Then the console the URL asked for, which the setup had stood in front of.
    await expect(page.getByTestId('admin-dashboard')).toBeVisible({ timeout: 30_000 });
    await page.goto(CONSOLE);
    await expect(page.getByTestId('console-picker')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('picker-tfa-on')).toBeVisible();
    await expect(page.getByTestId(`open-admin-${facility.hospitalId}`)).toBeVisible({
      timeout: 30_000,
    });

    // From now on the password is half a sign-in.
    await signOut(page);
    await signIn(page, facility.adminEmail);
    await expect(page.getByTestId('two-factor-code')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('console-picker')).toHaveCount(0);

    await page.getByTestId('tfa-code').fill('000000');
    await page.getByTestId('tfa-submit').click();
    await expect(page.getByTestId('tfa-error')).toContainText('কোডটি মেলেনি');

    await enterCode(page, facility.adminEmail);
    await expect(page.getByTestId('console-picker')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(`open-admin-${facility.hospitalId}`)).toBeVisible({
      timeout: 30_000,
    });

    // A lost phone: a recovery code, typed off paper, signs in once.
    await signOut(page);
    await signIn(page, facility.adminEmail);
    const recovery = enrolmentOf(facility.adminEmail).recoveryCodes[0] ?? '';
    await page.getByTestId('tfa-code').fill(recovery.toUpperCase());
    await page.getByTestId('tfa-submit').click();
    await expect(page.getByTestId('console-picker')).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('anybody else may turn it on, and an administrator resets it (S-B-11)', () => {
  test.setTimeout(180_000);

  test('a receptionist turns it on from the picker; a lost phone is reset by the administrator', async ({
    page,
    browser,
  }) => {
    const facility = await newFacility(PASSWORD);
    made.push(facility);
    const reception = await addStaffMember(facility.hospitalId, 'receptionist', PASSWORD);

    // Not asked for one, but offered it — and free to leave.
    await signIn(page, reception.email);
    await expect(page.getByTestId('console-picker')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('picker-tfa-setup').click();
    await expect(page.getByTestId('tfa-setup-cancel')).toBeVisible({ timeout: 30_000 });
    await completeSetup(page, reception.email);
    await expect(page.getByTestId('picker-tfa-on')).toBeVisible({ timeout: 30_000 });

    // The administrator, at another desk.
    const desk = await browser.newContext();
    try {
      const admin = await desk.newPage();
      await signIn(admin, facility.adminEmail);
      await passSecondFactor(admin, facility.adminEmail);
      await admin.getByTestId(`open-admin-${facility.hospitalId}`).click();
      await expect(admin.getByTestId('admin-dashboard')).toBeVisible({ timeout: 30_000 });
      await admin.getByTestId('admin-open-settings').click();
      await expect(admin.getByTestId('hospital-settings')).toBeVisible({ timeout: 30_000 });
      await admin.getByTestId('settings-tab-staff').click();

      const card = admin.getByTestId(`settings-staff-${reception.id}`);
      await expect(card).toContainText('দুই ধাপ চালু');
      await admin.getByTestId(`settings-staff-reset-2fa-${reception.id}`).click();
      await expect(card).not.toContainText('দুই ধাপ চালু');
      await expect(admin.getByTestId(`settings-staff-reset-2fa-${reception.id}`)).toHaveCount(0);
    } finally {
      await desk.close();
    }

    // The receptionist's next sign-in asks for no code.
    const next = await browser.newContext();
    try {
      const again = await next.newPage();
      await signIn(again, reception.email);
      await expect(again.getByTestId('console-picker')).toBeVisible({ timeout: 30_000 });
      await expect(again.getByTestId('picker-tfa-setup')).toBeVisible();
    } finally {
      await next.close();
    }
  });
});
