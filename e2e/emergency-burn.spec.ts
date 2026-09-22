/**
 * The emergency scenario, end to end — `PRD.md` §24 step 7, and step 15's
 * definition of done (`CLAUDE.md` §4): "Burn-case scenario E2E passes".
 *
 * "A burn case searches nearby hospitals, sees which has a free burn bed with
 * fresh data, taps 'I'm on my way'; the emergency console shows the inbound
 * alert." Two browser contexts — Padma's ER console, and a phone standing at
 * Farmgate — against the real API, the real ranking and the real socket.
 *
 * From Farmgate, Jamuna is the nearer burn unit. It is also the one whose burn
 * beds nobody has confirmed for hours, so `FR-PAT-45` ranks the fresh Padma
 * first and labels Jamuna stale — which is the whole claim of the scenario.
 *
 * The rest follow the alert: the ER prepares and the family's screen says so;
 * a decline reaches the family with its reason; the critical path answers with
 * one hospital; a phone with no location is still answered, honestly; the ER
 * hands a case to the ward; and the ER keeps working offline (`FR-OFF-01`).
 */

import { expect, test, type Browser, type Page } from '@playwright/test';

import {
  FARMGATE,
  caseState,
  erHospital,
  freshenPadma,
  registerWalkIn,
  sendAlert,
  type ErHospital,
} from './support/emergency.js';
import { bedState, createWardFixture } from './support/ward.js';

const CONSOLE = 'http://localhost:3100';
const PATIENT = 'http://localhost:3000';

/** `NFR-01` is two seconds for the queue; an alert is held to the same socket. */
const ALERT_BUDGET_MS = 5_000;
/** The family's screen looks every five seconds (`S-A-10c`); give it two looks. */
const FAMILY_BUDGET_MS = 12_000;

let padma: ErHospital;
let jamuna: ErHospital;
let shapla: ErHospital;

test.beforeEach(async () => {
  [padma, jamuna, shapla] = await Promise.all([
    erHospital('Padma Specialised'),
    erHospital('Jamuna Medical College'),
    erHospital('Shapla General'),
  ]);
  await freshenPadma(padma);
});

async function phoneAtFarmgate(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    geolocation: FARMGATE,
    permissions: ['geolocation'],
    viewport: { width: 390, height: 844 },
  });
  return await context.newPage();
}

async function openErConsole(page: Page, er: ErHospital): Promise<void> {
  await page.addInitScript(
    ([token, hospitalId]) => {
      sessionStorage.setItem(
        'console.demo-session',
        JSON.stringify({ token, hospitalId, staffName: 'ER (Demo)', role: 'emergency' }),
      );
    },
    [er.erToken, er.hospitalId],
  );
  await page.goto(`${CONSOLE}/?view=er`);
  await expect(page.getByTestId('er-console')).toBeVisible();
  await expect(page.getByTestId('offline-block')).toHaveAttribute('data-connected', 'true', {
    timeout: 15_000,
  });
}

test.describe('the burn scenario (PRD.md §24 step 7)', () => {
  test('a burn case sees the fresh Padma above the nearer, stale Jamuna, and the ER is told', async ({
    page,
    browser,
  }) => {
    await openErConsole(page, padma);
    const phone = await phoneAtFarmgate(browser);

    // S-A-10 → জরুরি → দগ্ধ. No login, no phone number (GR-08).
    await phone.goto(`${PATIENT}/emergency`);
    await expect(phone.getByTestId('call-999')).toHaveAttribute('href', 'tel:999');
    await phone.getByTestId('emergency-urgent').click();
    await phone.getByTestId('problem-burn').click();

    // S-A-10b: Padma first and fresh; Jamuna second, nearer, and saying it is stale.
    const results = phone.locator('[data-testid^="result-"][data-stale]');
    await expect(results.first()).toBeVisible({ timeout: 20_000 });
    const lead = phone.getByTestId(`result-${padma.hospitalId}`);
    const second = phone.getByTestId(`result-${jamuna.hospitalId}`);

    await expect(results.nth(0)).toHaveAttribute('data-testid', `result-${padma.hospitalId}`);
    await expect(results.nth(1)).toHaveAttribute('data-testid', `result-${jamuna.hospitalId}`);
    await expect(lead).toHaveAttribute('data-stale', 'false');
    await expect(lead).toContainText('চিকিৎসা আছে');
    await expect(lead.getByTestId('result-beds')).toContainText('বার্ন');
    await expect(second).toHaveAttribute('data-stale', 'true');
    await expect(second.getByTestId('result-stale')).toBeVisible();
    // Shapla has no burn unit: listed, and saying so.
    await expect(phone.getByTestId(`result-${shapla.hospitalId}`)).toContainText('চিকিৎসা নেই');

    // BTN-A10-ONWAY, with nothing filled in.
    await phone.getByTestId(`onway-${padma.hospitalId}`).click();
    await phone.getByTestId('onway-send').click();

    // S-A-10c opens, waiting on the hospital.
    await expect(phone.getByTestId('onway-status')).toHaveAttribute('data-state', 'inbound', {
      timeout: 15_000,
    });

    // The ER console rings: a new, unanswered alert for this burn.
    const caseId = await phone.getByTestId('onway-status').getAttribute('data-case-id');
    const alert = page.getByTestId(`er-inbound-${caseId ?? ''}`);
    await expect(alert).toBeVisible({ timeout: ALERT_BUDGET_MS });
    await expect(alert).toHaveAttribute('data-state', 'inbound');
    await expect(alert).toHaveAttribute('data-new', 'true');
    await expect(alert).toContainText('দগ্ধ');

    // The coordinator prepares; the family's screen says the hospital is ready.
    await page.getByTestId(`er-prepare-${caseId ?? ''}`).click();
    await expect(phone.getByTestId('onway-status')).toHaveAttribute('data-state', 'acknowledged', {
      timeout: FAMILY_BUDGET_MS,
    });
    await expect(phone.getByTestId('onway-headline')).toHaveText('হাসপাতাল প্রস্তুত');

    // They arrive: accepted, given a token, on the triage list.
    await expect(alert).toHaveAttribute('data-state', 'acknowledged');
    await page.getByTestId(`er-accept-${caseId ?? ''}`).click();
    await expect(page.getByTestId(`er-row-${caseId ?? ''}`)).toBeVisible();
    await expect(page.getByTestId(`er-row-${caseId ?? ''}`).getByTestId('er-token')).toContainText(
      'ER-',
    );
    await expect(phone.getByTestId('onway-status')).toHaveAttribute('data-state', 'arrived', {
      timeout: FAMILY_BUDGET_MS,
    });
  });
});

test.describe('what follows an alert (FR-EMG-02, FR-PAT-46)', () => {
  test('a decline reaches the family with its reason, and somewhere to go', async ({
    page,
    browser,
  }) => {
    const { caseId, token } = await sendAlert(padma.hospitalId, 'burn');
    await openErConsole(page, padma);

    const phone = await phoneAtFarmgate(browser);
    await phone.goto(`${PATIENT}/emergency/onway?t=${encodeURIComponent(token)}`);
    await expect(phone.getByTestId('onway-status')).toHaveAttribute('data-state', 'inbound');

    await page.getByTestId(`er-decline-${caseId}`).click();
    await page.getByTestId('er-decline-reason').fill('বার্ন ইউনিটে জায়গা নেই (ডেমো)');
    await page.getByTestId('er-decline-confirm').click();
    // The refer-out search for that capability opens at once (FR-EMG-02).
    await expect(page.getByTestId('er-suggestions')).toBeVisible();

    await expect(phone.getByTestId('onway-status')).toHaveAttribute('data-state', 'declined', {
      timeout: FAMILY_BUDGET_MS,
    });
    await expect(phone.getByTestId('onway-reason')).toContainText('বার্ন ইউনিটে জায়গা নেই');
    await expect(phone.getByTestId('onway-find-another')).toHaveAttribute(
      'href',
      '/emergency/results?problem=burn',
    );
  });

  test('the family can call it off, and the ER hears', async ({ page, browser }) => {
    const { caseId, token } = await sendAlert(padma.hospitalId, 'accident');
    await openErConsole(page, padma);
    await expect(page.getByTestId(`er-inbound-${caseId}`)).toBeVisible();

    const phone = await phoneAtFarmgate(browser);
    await phone.goto(`${PATIENT}/emergency/onway?t=${encodeURIComponent(token)}`);
    await phone.getByTestId('onway-cancel').click();
    await phone.getByTestId('onway-cancel-confirm').click();
    await expect(phone.getByTestId('onway-status')).toHaveAttribute('data-state', 'cancelled');

    await expect(page.getByTestId(`er-inbound-${caseId}`)).toHaveCount(0, {
      timeout: ALERT_BUDGET_MS,
    });
    expect((await caseState(caseId)).state).toBe('cancelled');
  });
});

test.describe('the two ways in (FR-PAT-41) and a phone with no location', () => {
  test('critical answers with one hospital and the call, without browsing', async ({ browser }) => {
    const phone = await phoneAtFarmgate(browser);
    await phone.goto(`${PATIENT}/emergency`);
    await phone.getByTestId('emergency-critical').click();

    await expect(phone.getByTestId('results-call-999')).toHaveAttribute('href', 'tel:999');
    const cards = phone.locator('[data-testid^="result-"][data-stale]');
    await expect(cards).toHaveCount(1, { timeout: 20_000 });
    // Nothing chosen yet, so the nearest ER: Shapla, from Farmgate.
    await expect(cards.first()).toHaveAttribute('data-testid', `result-${shapla.hospitalId}`);

    // Narrowing to a burn keeps one answer — the nearest able to treat it.
    await phone.getByTestId('narrow-burn').click();
    await expect(cards).toHaveCount(1, { timeout: 20_000 });
    await expect(cards.first()).toHaveAttribute('data-testid', `result-${padma.hospitalId}`);
  });

  test('a phone that shares no location is still answered, and told why there is no distance', async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const phone = await context.newPage();
    await phone.goto(`${PATIENT}/emergency/results?problem=stroke`);

    await expect(phone.getByTestId('no-location')).toBeVisible({ timeout: 20_000 });
    await expect(phone.locator('[data-testid^="result-"][data-stale]').first()).toBeVisible();
    await expect(phone.getByTestId('result-distance')).toHaveCount(0);
  });
});

test.describe('the ER hands a case to the ward (BTN-B07-ADMIT, FR-BED-07)', () => {
  test('the ward sees it by token, and admits it with the name taken at the bed', async ({
    page,
    browser,
  }) => {
    const ward = await createWardFixture(2);
    const walkIn = await registerWalkIn(shapla, 'cardiac');

    await openErConsole(page, shapla);
    await page.getByTestId(`er-admit-${walkIn.caseId}`).click();
    await page.getByTestId('er-admit-kind-general').click();
    await expect(
      page.getByTestId(`er-row-${walkIn.caseId}`).getByTestId('er-handed-off'),
    ).toBeVisible();

    const wardContext = await browser.newContext();
    const board = await wardContext.newPage();
    await board.addInitScript(
      ([token, hospitalId]) => {
        sessionStorage.setItem(
          'console.demo-session',
          JSON.stringify({ token, hospitalId, staffName: 'Ward (Demo)', role: 'ward' }),
        );
      },
      [ward.token, ward.hospitalId],
    );
    await board.goto(`${CONSOLE}/?view=ward`);
    await expect(board.getByTestId(`handoff-${walkIn.caseId}`)).toBeVisible({ timeout: 15_000 });

    const bed = ward.beds[0];
    if (bed === undefined) throw new Error('fixture has no bed');
    await board.getByTestId(`admit-handoff-${walkIn.caseId}`).click();
    await board.getByTestId(`handoff-bed-${walkIn.caseId}-${bed.label}`).click();

    // The bed panel opens on the admit form with the ER case already chosen.
    await expect(board.getByTestId(`admit-er-${walkIn.caseId}`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(board.getByTestId('admit-age')).toHaveValue('55');
    await board.getByTestId('admit-name').fill('রাবেয়া খাতুন (ডেমো)');
    await board.getByTestId('admit-phone').fill('01799887766');
    await board.getByTestId('admit-confirm').click();

    await expect.poll(async () => await bedState(bed.id)).toBe('occupied');
    await expect.poll(async () => (await caseState(walkIn.caseId)).state).toBe('admitted');
    // And it leaves the ER's list.
    await expect(page.getByTestId(`er-row-${walkIn.caseId}`)).toHaveCount(0, {
      timeout: ALERT_BUDGET_MS,
    });
  });
});

test.describe('the ER keeps working offline (FR-OFF-01)', () => {
  test('triage and a walk-in are queued, counted, and sent in order on reconnect', async ({
    page,
  }) => {
    const walkIn = await registerWalkIn(shapla, 'breathing');
    await openErConsole(page, shapla);
    await expect(page.getByTestId(`er-row-${walkIn.caseId}`)).toBeVisible();

    await page.context().setOffline(true);
    await expect(page.getByTestId('er-offline')).toBeVisible();

    await page.getByTestId(`er-triage-yellow-${walkIn.caseId}`).click();
    // Applied on screen at once, before anything reached the server.
    await expect(page.getByTestId(`er-row-${walkIn.caseId}`)).toHaveAttribute(
      'data-triage',
      'yellow',
    );

    await page.getByTestId('er-walkin').click();
    await page.getByRole('button', { name: 'দগ্ধ' }).click();
    await page.getByTestId('er-walkin-save').click();
    // Counted where the ward and reception count theirs (FR-OFF-01).
    await expect(page.getByTestId('pending-count')).toContainText('২');

    expect((await caseState(walkIn.caseId)).triage).toBe('red');

    await page.context().setOffline(false);
    await expect
      .poll(async () => (await caseState(walkIn.caseId)).triage, { timeout: 20_000 })
      .toBe('yellow');
    await expect(page.getByTestId('offline-block')).toHaveAttribute('data-connected', 'true', {
      timeout: 20_000,
    });
  });
});
