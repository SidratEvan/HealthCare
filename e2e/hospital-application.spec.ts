/**
 * A hospital applies by itself (`PRD.md` `FR-ONB-09`, `FR-ONB-10`; plan D1;
 * `APP_FLOW.md` B0 `S-B-00a`).
 *
 * The form is public. What these tests walk: somebody with no account opens
 * it, is told that applying publishes nothing, fills it in and sends it; is
 * given a hospital code and told what happens next; signs in with the
 * password they chose and is asked to set up two-step verification before
 * anything opens; the platform sees the workspace among those waiting, marked
 * as an application; and no patient can find the hospital. What the API
 * refuses and writes is held by `orgApplication.routes.test.ts`.
 *
 * Every workspace made here is demonstration data and is removed afterwards.
 */

import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';

import { E2E_DATABASE_URL, assertLocalDatabase } from './support/database.js';

const CONSOLE = 'http://localhost:3100';
const PATIENT = 'http://localhost:3000';

/** A river no seeded hospital is named for. */
const MARK = 'Dhaleshwari';
const PASSWORD = 'a-password-of-their-own';

async function removeAll(): Promise<void> {
  assertLocalDatabase();
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const made = await client.query<{ id: string }>(
      'SELECT id FROM hospitals WHERE name_en LIKE $1',
      [`${MARK}%`],
    );
    for (const { id } of made.rows) {
      await client.query('DELETE FROM audit_log WHERE hospital_id = $1', [id]);
      await client.query(
        'DELETE FROM sessions_auth WHERE subject_id IN (SELECT id FROM staff_users WHERE hospital_id = $1)',
        [id],
      );
      await client.query('DELETE FROM staff_roles WHERE hospital_id = $1', [id]);
      await client.query('DELETE FROM staff_users WHERE hospital_id = $1', [id]);
      await client.query('DELETE FROM hospital_settings WHERE hospital_id = $1', [id]);
      await client.query('DELETE FROM hospitals WHERE id = $1', [id]);
    }
  } finally {
    await client.end();
  }
}

test.beforeAll(removeAll);
test.afterEach(removeAll);

function email(): string {
  return `applicant-${String(Date.now())}@dhaleshwari.example`;
}

/** Everything but the two passwords, typed the way a person types it. */
async function fillFacility(page: Page, adminEmail: string): Promise<void> {
  await page.getByTestId('apply-name-bn').fill('ধলেশ্বরী ক্লিনিক (ডেমো)');
  await page.getByTestId('apply-name-en').fill(`${MARK} Clinic (Demo)`);
  await page.getByTestId('apply-kind-clinic').click();
  await page.getByTestId('apply-division-Dhaka').click();
  await page.getByTestId('apply-district').fill('Munshiganj');
  await page.getByTestId('apply-phone').fill('02 912345678');
  await page.getByTestId('apply-registration').fill('DEMO-REG-7001');
  await page.getByTestId('apply-admin-name').fill('Demo Applicant');
  await page.getByTestId('apply-admin-email').fill(adminEmail);
  await page.getByTestId('apply-admin-mobile').fill('01712-345678');
}

test.describe('a hospital applies by itself (FR-ONB-09)', () => {
  test.setTimeout(180_000);

  test('from no account to a workspace that is setting up, seen by the platform and by no patient', async ({
    page,
    context,
  }) => {
    const adminEmail = email();

    // --- the door: beside signing in, on the picker --------------------------
    await page.goto(CONSOLE);
    await expect(page.getByTestId('console-picker')).toBeVisible({ timeout: 45_000 });
    await page.getByTestId('picker-apply-link').click();
    await expect(page.getByTestId('apply-form')).toBeVisible();

    // Said before anything is typed: applying publishes nothing. And on a
    // demonstration, that real details do not belong here.
    await expect(page.getByTestId('apply-nothing-public')).toContainText(
      'আবেদন করলেই হাসপাতাল রোগীদের অ্যাপে দেখা যায় না',
    );
    await expect(page.getByTestId('apply-demo-note')).toBeVisible();
    await expect(page.getByTestId('apply-submit')).toHaveAttribute('aria-disabled', 'true');

    // --- the form says what is wrong with a field, as it is typed -------------
    await fillFacility(page, adminEmail);
    await page.getByTestId('apply-admin-mobile').fill('0171234');
    await expect(page.getByText('মোবাইল নম্বরটি ঠিক নয়')).toBeVisible();
    await page.getByTestId('apply-admin-mobile').fill('01712-345678');
    await expect(page.getByText('মোবাইল নম্বরটি ঠিক নয়')).toHaveCount(0);

    await page.getByTestId('apply-password').fill('short');
    await expect(page.getByText('পাসওয়ার্ডটি ছোট')).toBeVisible();
    await page.getByTestId('apply-password').fill(PASSWORD);
    await page.getByTestId('apply-password-again').fill('something-else-entirely');
    await expect(page.getByText('দুটি পাসওয়ার্ড মিলছে না।')).toBeVisible();
    await expect(page.getByTestId('apply-submit')).toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('apply-password-again').fill(PASSWORD);
    await expect(page.getByTestId('apply-submit')).not.toHaveAttribute('aria-disabled', 'true');

    // --- sent ------------------------------------------------------------------
    await page.getByTestId('apply-submit').click();
    await expect(page.getByTestId('apply-done')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('apply-done-code')).toHaveText('DHALESHWARI');
    await expect(page.getByTestId('apply-done-email')).toHaveText(adminEmail);
    // Still nothing public, said again on the answer.
    await expect(page.getByTestId('apply-done-not-public')).toBeVisible();
    // The password is not on the page.
    await expect(page.locator('body')).not.toContainText(PASSWORD);

    // --- the applicant signs in with their own password -------------------------
    await page.getByTestId('apply-done-login').click();
    await expect(page.getByTestId('staff-login')).toBeVisible();
    await page.getByTestId('login-email').fill(adminEmail);
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    // An administrator: two-step verification before any console opens.
    await expect(page.getByTestId('two-factor-setup')).toBeVisible({ timeout: 30_000 });

    // --- the platform sees an application among those waiting --------------------
    const platform = await context.newPage();
    await platform.goto(CONSOLE);
    await expect(platform.getByTestId('console-picker')).toBeVisible({ timeout: 45_000 });
    await platform.getByTestId('open-platform').click();
    await expect(platform.getByTestId('platform-console')).toBeVisible({ timeout: 30_000 });
    const row = platform.getByTestId('platform-row-DHALESHWARI');
    await expect(row).toHaveAttribute('data-lifecycle', 'setup');
    await expect(row.getByTestId('platform-self-registered')).toHaveText('নিজে আবেদন করেছে');
    // A workspace the platform made itself carries no such mark.
    await expect(
      platform.getByTestId('platform-row-PADMA').getByTestId('platform-self-registered'),
    ).toHaveCount(0);

    await row.click();
    await expect(platform.getByTestId('platform-workspace')).toHaveAttribute(
      'data-lifecycle',
      'setup',
    );
    const applied = platform.getByTestId('platform-applied');
    await expect(applied).toContainText('DEMO-REG-7001');
    await expect(applied).toContainText('+8802912345678');
    await expect(platform.getByTestId('platform-workspace')).toContainText(adminEmail);
    await expect(platform.getByTestId('platform-workspace')).toContainText('+880 1712-345678');

    // --- and no patient can find it -----------------------------------------------
    const phone = await context.newPage();
    await phone.goto(`${PATIENT}/search`);
    await expect(phone.getByTestId('search-results')).toBeVisible({ timeout: 45_000 });
    await phone.getByTestId('search-input').fill(MARK);
    await expect(phone.getByTestId('search-empty')).toBeVisible({ timeout: 30_000 });
    await phone.goto(`${PATIENT}/?scope=DHALESHWARI`);
    // A code that is not a live hospital's is nobody's: the network's own app.
    await expect(phone.getByTestId('app-name')).toHaveText('MedLiveBD');

    // --- the platform can decline it: close it, with the reason (FR-ONB-10) -------
    // While it is setting up the next move is the hospital's, and closing is
    // the one thing the platform is offered.
    await expect(platform.getByTestId('platform-no-actions')).toBeVisible();
    await expect(platform.getByTestId('platform-decline-line')).toBeVisible();
    await expect(platform.getByTestId('platform-act-approve')).toHaveCount(0);
    const decline = platform.getByTestId('platform-act-close');
    await expect(decline).toHaveAttribute('aria-disabled', 'true');
    await platform.getByTestId('platform-note').fill('আবেদনটি যাচাই করা যায়নি (ডেমো)।');
    await platform.getByTestId('platform-close-sure').check();
    await expect(decline).not.toHaveAttribute('aria-disabled', 'true');
    await decline.click();
    await expect(platform.getByTestId('platform-workspace')).toHaveAttribute(
      'data-lifecycle',
      'closed',
      { timeout: 30_000 },
    );
    await expect(platform.getByTestId('platform-row-DHALESHWARI')).toHaveAttribute(
      'data-lifecycle',
      'closed',
    );
    await expect(platform.getByTestId('platform-decline-line')).toHaveCount(0);
  });

  test('a refusal says which it was and keeps what was typed; offline says why it cannot be sent', async ({
    page,
    context,
  }) => {
    const adminEmail = email();
    await page.goto(`${CONSOLE}/?apply=1`);
    await expect(page.getByTestId('apply-form')).toBeVisible({ timeout: 45_000 });
    await fillFacility(page, adminEmail);
    await page.getByTestId('apply-password').fill(PASSWORD);
    await page.getByTestId('apply-password-again').fill(PASSWORD);

    // The platform has too many waiting: said as that, not as a fault.
    await page.route('**/api/v1/hospital-applications', async (route) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests.',
            details: { reason: 'applications_paused' },
          },
        }),
      });
    });
    await page.getByTestId('apply-submit').click();
    await expect(page.getByTestId('apply-refused')).toHaveAttribute('data-reason', 'paused');
    await expect(page.getByTestId('apply-refused')).toContainText('নতুন আবেদন নেওয়া বন্ধ আছে');
    // What was typed is still there.
    await expect(page.getByTestId('apply-name-en')).toHaveValue(`${MARK} Clinic (Demo)`);
    await expect(page.getByTestId('apply-admin-email')).toHaveValue(adminEmail);
    await page.unroute('**/api/v1/hospital-applications');

    // Offline: the form stays, and the button says why it cannot be pressed.
    await context.setOffline(true);
    await expect(page.getByTestId('apply-offline')).toBeVisible();
    await expect(page.getByTestId('apply-submit')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('apply-name-en')).toHaveValue(`${MARK} Clinic (Demo)`);

    // Back, and it goes.
    await context.setOffline(false);
    await expect(page.getByTestId('apply-offline')).toHaveCount(0);
    await page.getByTestId('apply-submit').click();
    await expect(page.getByTestId('apply-done')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('apply-done-code')).toHaveText('DHALESHWARI');
  });

  test('sign-in offers the form too, and the form leads back to sign-in', async ({ page }) => {
    await page.goto(`${CONSOLE}/?login=1`);
    await expect(page.getByTestId('staff-login')).toBeVisible({ timeout: 45_000 });
    await page.getByTestId('login-apply-link').click();
    await expect(page.getByTestId('apply-form')).toBeVisible();
    await page.getByTestId('apply-login-link').click();
    await expect(page.getByTestId('staff-login')).toBeVisible();
  });
});
