/**
 * The second factor, as a person's phone would answer it (pilot step 28,
 * `FR-SEC-10`).
 *
 * Every administrator now meets `S-B-00d` at their first sign-in and `S-B-00b`
 * at every one after, so a spec that signs in as one passes through here. The
 * code is computed from the key the setup screen shows — read off the page,
 * the way a person who cannot scan types it — with the API's own TOTP, so the
 * spec proves the screen hands out a key an authenticator app can use.
 *
 * A code works once (`totp_last_step`), so the helper remembers the last step
 * it used for each account and never offers it again; if a spec signs in
 * faster than the window allows, it waits for the next half-minute rather than
 * sending a code it knows is spent.
 */

import { expect, type Page } from '@playwright/test';

import { codeAt, stepAt } from '../../backend/api/src/config/totp.js';

interface Enrolled {
  readonly secret: string;
  lastStep: number;
  readonly recoveryCodes: readonly string[];
}

const enrolled = new Map<string, Enrolled>();

/** The account's key and unused recovery codes, once `completeSetup` has run for it. */
export function enrolmentOf(email: string): Enrolled {
  const found = enrolled.get(email);
  if (found === undefined) throw new Error(`${email} has not set up a second factor in this run`);
  return found;
}

/** The earliest step the server will still take for this account. */
async function nextStep(page: Page, lastStep: number | null): Promise<number> {
  for (;;) {
    const current = stepAt(Date.now());
    const step = Math.max(current - 1, lastStep === null ? current - 1 : lastStep + 1);
    if (step <= current + 1) return step;
    // Every code in the window is spent: the next one exists in under 30 s.
    await page.waitForTimeout(((current + 1) * 30 - Date.now() / 1_000) * 1_000 + 250);
  }
}

/** `S-B-00d`: reads the key, turns it on, keeps the recovery codes, continues. */
export async function completeSetup(page: Page, email: string): Promise<Enrolled> {
  await expect(page.getByTestId('two-factor-setup')).toBeVisible({ timeout: 30_000 });
  const shown = await page.getByTestId('tfa-secret').textContent({ timeout: 30_000 });
  const secret = (shown ?? '').replace(/\s/g, '');
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);

  const step = await nextStep(page, null);
  await page.getByTestId('tfa-setup-code').fill(codeAt(secret, step));
  await page.getByTestId('tfa-setup-submit').click();

  const list = page.getByTestId('tfa-recovery-codes');
  await expect(list.locator('li')).toHaveCount(10);
  const recoveryCodes = await list.locator('li').allTextContents();
  // Not before the person says they have kept them (FRONTEND.md §5.1: the
  // button says why it is off).
  const onward = page.getByTestId('tfa-recovery-continue');
  await expect(onward).toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('tfa-recovery-kept').check();
  await onward.click();

  const record: Enrolled = { secret, lastStep: step, recoveryCodes };
  enrolled.set(email, record);
  return record;
}

/** `S-B-00b`: the account's current code from the app. */
export async function enterCode(page: Page, email: string): Promise<void> {
  const record = enrolmentOf(email);
  await expect(page.getByTestId('two-factor-code')).toBeVisible({ timeout: 30_000 });
  const step = await nextStep(page, record.lastStep);
  await page.getByTestId('tfa-code').fill(codeAt(record.secret, step));
  record.lastStep = step;
  await page.getByTestId('tfa-submit').click();
}

/**
 * After the password: whichever second-factor screen comes, if one does. A
 * first sign-in for an administrator sets it up; a later one asks for the
 * code; anybody else goes straight to the picker.
 */
export async function passSecondFactor(page: Page, email: string): Promise<void> {
  const setup = page.getByTestId('two-factor-setup');
  const code = page.getByTestId('two-factor-code');
  const picker = page.getByTestId('console-picker');
  await expect(setup.or(code).or(picker)).toBeVisible({ timeout: 30_000 });
  if (await setup.isVisible()) {
    await completeSetup(page, email);
  } else if (await code.isVisible()) {
    await enterCode(page, email);
  }
}
