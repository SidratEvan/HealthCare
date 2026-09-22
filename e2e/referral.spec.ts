/**
 * Referrals between two ERs, end to end — step 16 (`FR-EMG-07..09`).
 *
 * Two browser contexts, two ER consoles — Jamuna sending, Shapla receiving —
 * against the real API, the real ranking and the real socket. What the step
 * promises is a timeline both sides can watch move: sent, seen, accepted,
 * arrived (`FR-EMG-08`), and a person who leaves one triage list and joins the
 * other at the moment the receiving ER says they are at its door (the owner's
 * ruling, 2026-09-22).
 *
 * The rest follow it: a decline reaches the sender with its reason and the
 * case is theirs to try elsewhere; a withdrawal clears the receiver's card; an
 * answer given offline is kept and sent (`FR-OFF-01`); and the consoles open
 * on the seeded referrals, not on empty lists.
 */

import { expect, test, type Browser, type Page } from '@playwright/test';

import {
  caseState,
  erHospital,
  openErConsole,
  referralOf,
  referralStep,
  registerWalkIn,
  sendReferral,
  type ErHospital,
} from './support/emergency.js';

/** A referral travels the socket an alert does, and is held to the same budget. */
const BUDGET_MS = 5_000;

let jamuna: ErHospital;
let shapla: ErHospital;
let padma: ErHospital;
let karnaphuli: ErHospital;

test.beforeEach(async () => {
  [jamuna, shapla, padma, karnaphuli] = await Promise.all([
    erHospital('Jamuna Medical College'),
    erHospital('Shapla General'),
    erHospital('Padma Specialised'),
    erHospital('Karnaphuli General'),
  ]);
});

/** The other ER, in a browser of its own. */
async function secondConsole(browser: Browser, er: ErHospital): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await openErConsole(page, er);
  return page;
}

test.describe('the ERs open on referrals, not on empty lists (FR-DEM-04)', () => {
  test('Shapla has Jamuna’s asks waiting, and Padma sees Shapla’s decline on its row', async ({
    page,
    browser,
  }) => {
    await openErConsole(page, shapla);
    const incoming = page.getByTestId('er-incoming');
    await expect(incoming.locator('article[data-state="seen"]').first()).toBeVisible();
    await expect(incoming.locator('article[data-state="accepted"]').first()).toBeVisible();
    // Today's list carries the one that finished this morning, whole.
    const arrived = page.getByTestId('er-referrals-today').locator('li[data-state="arrived"]');
    await expect(arrived.first()).toBeVisible();
    for (const step of ['sent', 'seen', 'accepted', 'arrived']) {
      await expect(arrived.first().locator(`[data-step="${step}"]`)).toBeVisible();
    }

    const padmaPage = await secondConsole(browser, padma);
    await expect(
      padmaPage.locator('[data-testid^="er-referral-"][data-state="declined"]').first(),
    ).toBeVisible();
  });

  test('Karnaphuli, two hundred kilometres from any other ER, is told so honestly', async ({
    page,
  }) => {
    const walkIn = await registerWalkIn(karnaphuli, 'cardiac');
    await openErConsole(page, karnaphuli);
    await page.getByTestId(`er-refer-${walkIn.caseId}`).click();
    await expect(page.getByTestId('er-refer-empty')).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('refer out, refer in, and the timeline (FR-EMG-07, FR-EMG-08, FR-EMG-09)', () => {
  test('Jamuna refers; Shapla sees, accepts and receives the person; both keep the timeline', async ({
    page,
    browser,
  }) => {
    const walkIn = await registerWalkIn(jamuna, 'breathing');
    await openErConsole(page, jamuna);
    const shaplaPage = await secondConsole(browser, shapla);

    // BTN-B07-REFER. Breathing maps to no need, so the coordinator says one:
    // Jamuna has no ICU.
    await page.getByTestId(`er-refer-${walkIn.caseId}`).click();
    await expect(page.getByTestId('er-refer-sheet')).toBeVisible();
    await page
      .getByTestId('er-refer-bedkinds')
      .getByRole('button', { name: 'আইসিইউ', exact: true })
      .click();

    // FR-EMG-07: filtered by the need and a free bed. Padma's ICU is full —
    // left out, and counted rather than silently missing.
    await expect(page.getByTestId(`er-refer-result-${shapla.hospitalId}`)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId(`er-refer-result-${padma.hospitalId}`)).toHaveCount(0);
    await expect(page.getByTestId('er-refer-excluded')).toBeVisible();

    // BTN-B07-REFER-SEND-<hospitalId>, with a note.
    await page.getByTestId(`er-refer-send-${shapla.hospitalId}`).click();
    await page.getByTestId('er-refer-note').fill('অক্সিজেন চলছে');
    await page.getByTestId('er-refer-confirm').click();

    const line = page.getByTestId(`er-referral-${walkIn.caseId}`);
    await expect(line).toHaveAttribute('data-state', 'sent');
    // Held while Shapla answers: not to the ward, not home.
    await expect(page.getByTestId(`er-discharge-${walkIn.caseId}`)).toBeDisabled();

    await expect.poll(async () => (await referralOf(walkIn.caseId))?.state).toBe('sent');
    const referralId = (await referralOf(walkIn.caseId))?.id ?? '';

    // LIST-B07-IN at Shapla: new, with what the case says and the note.
    const card = shaplaPage.getByTestId(`er-incoming-${referralId}`);
    await expect(card).toBeVisible({ timeout: BUDGET_MS });
    await expect(card).toHaveAttribute('data-new', 'true');
    await expect(card.getByTestId('er-incoming-note')).toHaveText('অক্সিজেন চলছে');

    // The first touch is "seen", and Jamuna is told (FR-EMG-08).
    await card.getByTestId(`er-referral-timeline-${referralId}`).click();
    await expect(line.locator('[data-step="seen"]')).toBeVisible({ timeout: BUDGET_MS });

    await shaplaPage.getByTestId(`er-incoming-accept-${referralId}`).click();
    await expect(line).toHaveAttribute('data-state', 'accepted', { timeout: BUDGET_MS });
    // Still Jamuna's until Shapla records the arrival.
    await expect(page.getByTestId(`er-row-${walkIn.caseId}`)).toBeVisible();

    // BTN-B07-IN-ARRIVED: the handover.
    await shaplaPage.getByTestId(`er-incoming-arrived-${referralId}`).click();
    await expect.poll(async () => (await referralOf(walkIn.caseId))?.state).toBe('arrived');
    const received = (await referralOf(walkIn.caseId))?.arrivedCaseId ?? '';

    await expect(shaplaPage.getByTestId(`er-row-${received}`)).toBeVisible({
      timeout: BUDGET_MS,
    });
    await expect(shaplaPage.getByTestId(`er-row-${received}`).getByTestId('er-token')).toHaveText(
      /^ER-\d+$/,
    );
    await expect(page.getByTestId(`er-row-${walkIn.caseId}`)).toHaveCount(0, {
      timeout: BUDGET_MS,
    });
    expect((await caseState(walkIn.caseId)).state).toBe('referred');

    // The whole timeline, on both consoles.
    for (const console of [page, shaplaPage]) {
      const today = console.getByTestId(`er-today-${referralId}`);
      await expect(today).toHaveAttribute('data-state', 'arrived', { timeout: BUDGET_MS });
      for (const step of ['sent', 'seen', 'accepted', 'arrived']) {
        await expect(today.locator(`[data-step="${step}"]`)).toBeVisible();
      }
    }
  });

  test('a decline reaches the sender with its reason, and the case is theirs to try again', async ({
    page,
    browser,
  }) => {
    const walkIn = await registerWalkIn(jamuna, 'cardiac');
    const referralId = await sendReferral(jamuna, walkIn.caseId, shapla);
    await openErConsole(page, jamuna);
    const shaplaPage = await secondConsole(browser, shapla);

    await shaplaPage.getByTestId(`er-incoming-decline-${referralId}`).click();
    // GR-01: no reason, no decline.
    await shaplaPage.getByTestId('er-incoming-decline-confirm').click();
    await expect(shaplaPage.getByTestId(`er-incoming-${referralId}`)).toBeVisible();
    await shaplaPage.getByTestId('er-incoming-decline-reason').fill('কার্ডিয়াক টিম অস্ত্রোপচারে');
    await shaplaPage.getByTestId('er-incoming-decline-confirm').click();
    await expect(shaplaPage.getByTestId(`er-incoming-${referralId}`)).toHaveCount(0, {
      timeout: BUDGET_MS,
    });

    const line = page.getByTestId(`er-referral-${walkIn.caseId}`);
    await expect(line).toHaveAttribute('data-state', 'declined', { timeout: BUDGET_MS });
    await expect(line).toContainText('কার্ডিয়াক টিম অস্ত্রোপচারে');
    await expect(page.getByTestId(`er-refer-${walkIn.caseId}`)).toBeVisible();
    await expect(page.getByTestId(`er-discharge-${walkIn.caseId}`)).toBeEnabled();
  });

  test('the sender withdraws, and the receiver’s card goes', async ({ page, browser }) => {
    const walkIn = await registerWalkIn(jamuna, 'cardiac');
    const referralId = await sendReferral(jamuna, walkIn.caseId, shapla);
    await referralStep(shapla, referralId, 'accept');
    await openErConsole(page, jamuna);
    const shaplaPage = await secondConsole(browser, shapla);
    await expect(shaplaPage.getByTestId(`er-incoming-${referralId}`)).toHaveAttribute(
      'data-state',
      'accepted',
    );

    // BTN-B07-REFER-CANCEL, behind its confirmation.
    await page.getByTestId(`er-refer-cancel-${walkIn.caseId}`).click();
    await page.getByTestId('er-refer-cancel-confirm').click();

    await expect(shaplaPage.getByTestId(`er-incoming-${referralId}`)).toHaveCount(0, {
      timeout: BUDGET_MS,
    });
    await expect.poll(async () => (await referralOf(walkIn.caseId))?.state).toBe('cancelled');
    await expect(page.getByTestId(`er-discharge-${walkIn.caseId}`)).toBeEnabled();
  });
});

test.describe('the receiving ER keeps working offline (FR-OFF-01)', () => {
  test('an answer given offline is shown at once, counted, and sent on reconnect', async ({
    page,
  }) => {
    const walkIn = await registerWalkIn(jamuna, 'cardiac');
    const referralId = await sendReferral(jamuna, walkIn.caseId, shapla);
    await openErConsole(page, shapla);
    const card = page.getByTestId(`er-incoming-${referralId}`);
    await expect(card).toBeVisible();

    await page.context().setOffline(true);
    await expect(page.getByTestId('er-offline')).toBeVisible();

    // The touch that says "seen" and the accept: two actions, queued in order.
    await page.getByTestId(`er-incoming-accept-${referralId}`).click();
    await expect(card).toHaveAttribute('data-state', 'accepted');
    await expect(page.getByTestId('pending-count')).toContainText('২');
    expect((await referralOf(walkIn.caseId))?.state).toBe('sent');

    await page.context().setOffline(false);
    await expect
      .poll(async () => (await referralOf(walkIn.caseId))?.state, { timeout: 20_000 })
      .toBe('accepted');
  });
});
