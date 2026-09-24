/**
 * `e2e/language-switch.spec.ts` — বাংলা | English, at the top of both apps
 * (`GR-06`, `I18N-08`, `SEG-A00-LANG`, `SEG-B00-LANG`).
 *
 * The owner asked for "a version that says it's in English too — every single
 * thing", with a switch at the top of the hospital console and the patient
 * app. What a unit test cannot show, and this spec does:
 *
 * - the switch is there on the screens people actually open, and pressing it
 *   changes the whole screen at once — copy, digits, and the names that come
 *   from the database — without a reload (`I18N-08`);
 * - `<html lang>` follows, so the Bangla typesetting rules stop applying to
 *   English (`TYP-01`) and a screen reader changes voice;
 * - the choice outlives a reload and carries to the next screen;
 * - the live serial still moves in English, from a console left in Bangla —
 *   the two sides of the product need not agree on a language.
 *
 * "In English" is asserted as the absence of Bengali script wherever the
 * screen has nothing a person typed. Names people typed — a patient's, a
 * doctor's note — stay as they were written and are not checked.
 */

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { createConsoleSession, type ConsoleSession } from './support/console.js';
import { bookAsGuest, openLiveSerial } from './support/patient.js';

const PATIENT = 'http://localhost:3000';
const CONSOLE = 'http://localhost:3100';

/** Any character of the Bengali block. */
const BENGALI = /[ঀ-৿]/;

let demo: ConsoleSession;

test.beforeEach(async () => {
  demo = await createConsoleSession(3);
});

/** A context that has already chosen English, as a returning phone has. */
async function englishContext(context: BrowserContext): Promise<BrowserContext> {
  await context.addInitScript(() => {
    window.localStorage.setItem('platform.locale', 'en');
  });
  return context;
}

async function chooseEnglish(page: Page): Promise<void> {
  await page.getByTestId('language-en').click();
  await expect(page.getByTestId('language-en')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
}

test.describe('the patient app (SEG-A00-LANG)', () => {
  test('opens in Bangla, and one tap turns the whole home screen English', async ({ page }) => {
    await page.goto(PATIENT);

    // FR-LOC-01: Bangla until somebody chooses otherwise.
    await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
    await expect(page.getByTestId('language-bn')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('bottom-nav')).toContainText('হোম');

    await chooseEnglish(page);

    const nav = page.getByTestId('bottom-nav');
    for (const label of ['Home', 'Serials', 'Records', 'Profile']) {
      await expect(nav.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByTestId('emergency-card')).toContainText('Emergency');
    await expect(page.getByTestId(`specialty-${demo.departmentCode}`)).not.toHaveText(BENGALI);

    // Everything on the home screen is the product's own copy, so none of it
    // may be left in Bangla — except the switch's own "বাংলা", which names
    // the language in itself on purpose.
    const main = page.locator('main');
    await expect(main).not.toHaveText(BENGALI);
  });

  test('keeps English across a reload and onto the next screen', async ({ page }) => {
    await page.goto(PATIENT);
    await chooseEnglish(page);

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByTestId('bottom-nav')).toContainText('Home');

    // The hospital list's names and addresses come from the database; in
    // English they are the facility's English ones (`name_en`, `address_en`).
    await page.goto(`${PATIENT}/book?specialty=${demo.departmentCode}`);
    const card = page.getByTestId(`hospital-${demo.hospitalId}`);
    await expect(card).toBeVisible();
    await expect(card).not.toHaveText(BENGALI);
  });

  test('switches back to Bangla, digits and all', async ({ page }) => {
    await page.goto(`${PATIENT}/book?specialty=${demo.departmentCode}`);
    await chooseEnglish(page);
    await expect(page.getByTestId(`hospital-${demo.hospitalId}`)).not.toHaveText(BENGALI);

    await page.getByTestId('language-bn').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
    await expect(page.getByTestId(`hospital-${demo.hospitalId}`)).toHaveText(BENGALI);
  });
});

test.describe('the live serial in English (S-A-08)', () => {
  test('reads in English with Latin digits, and still moves when reception taps next', async ({
    browser,
  }) => {
    const counter = await browser.newContext();
    const corridor = await englishContext(await browser.newContext());

    try {
      const bookingPage = await (await browser.newContext()).newPage();
      const trackingUrl = await bookAsGuest(bookingPage, demo);

      const phone = await openLiveSerial(corridor, trackingUrl);
      await expect(phone.locator('html')).toHaveAttribute('lang', 'en');

      // The whole card — status, serial, the one being served, the estimate —
      // is the product's own words and figures, so none of it is Bangla.
      const card = phone.getByTestId('live-serial');
      await expect(card).toContainText('Your serial');
      await expect(card).not.toHaveText(BENGALI);
      await expect(phone.getByTestId('live-serial-number')).toHaveText(/^[0-9]+$/);

      // Reception, left in Bangla, taps next; the English phone follows.
      const reception = await counter.newPage();
      await reception.addInitScript((token: string) => {
        window.sessionStorage.setItem(
          'console.demo-session',
          JSON.stringify({ token, hospitalId: 'e2e', staffName: 'E2E' }),
        );
      }, demo.token);
      await reception.goto(`${CONSOLE}/?session=${demo.sessionId}`);
      await expect(reception.getByTestId('queue-table')).toBeVisible();
      await expect(reception.locator('html')).toHaveAttribute('lang', 'bn');

      const before = await phone.getByTestId('now-serving').textContent();
      await reception.getByTestId('call-next').click();
      await expect(phone.getByTestId('now-serving')).not.toHaveText(before ?? '');
      await expect(phone.getByTestId('now-serving')).not.toHaveText(BENGALI);
    } finally {
      await counter.close();
      await corridor.close();
    }
  });
});

test.describe('the hospital console (SEG-B00-LANG)', () => {
  test('the picker switches to English, facility names included', async ({ page }) => {
    await page.goto(CONSOLE);
    await expect(page.getByTestId('console-picker')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'কনসোল নির্বাচন করুন' })).toBeVisible();

    await chooseEnglish(page);

    await expect(page.getByRole('heading', { name: 'Choose a console' })).toBeVisible();
    // The facility buttons are names from the database (`hospitals.name_en`).
    const facilities = page.locator('[data-testid^="pick-hospital-"]');
    await expect(facilities.first()).toBeVisible();
    for (const facility of await facilities.all()) {
      await expect(facility).not.toHaveText(BENGALI);
    }
  });

  test('reception switches in place, keeps its queue, and remembers', async ({ page }) => {
    await page.addInitScript((token: string) => {
      window.sessionStorage.setItem(
        'console.demo-session',
        JSON.stringify({ token, hospitalId: 'e2e', staffName: 'E2E' }),
      );
    }, demo.token);
    await page.goto(`${CONSOLE}/?session=${demo.sessionId}`);
    await expect(page.getByTestId('queue-table')).toBeVisible();
    await expect(page.getByTestId('call-next')).toHaveText(BENGALI);

    await chooseEnglish(page);

    // The same queue, the same rows — only the language moved.
    await expect(page.getByTestId('queue-table')).toBeVisible();
    await expect(page.getByTestId('call-next')).toHaveText(
      /Call next patient|Finish and call next/,
    );
    await expect(page.getByTestId('console-rail')).toContainText('Queue');
    await expect(page.getByTestId('queue-table').getByRole('columnheader').first()).not.toHaveText(
      BENGALI,
    );

    await page.reload();
    await expect(page.getByTestId('queue-table')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByTestId('call-next')).not.toHaveText(BENGALI);
  });
});
