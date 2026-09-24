/**
 * `e2e/no-show-recovery.spec.ts` — required by CLAUDE.md §6.
 *
 * "No-show → slot offered → standby accepts → admin recovery figure changes."
 *
 * Step 19's definition of done, across two consoles: reception marks a
 * patient absent, gives the empty chair to the standby list (`BTN-B02-OFFER`,
 * `FR-REC-30`), records the standby patient's yes — and a hospital
 * administrator's dashboard (`S-B-10`), open in another browser, reports the
 * chair's fee as recovered (`FR-ADM-03`, `FR-QUE-31`).
 *
 * The figure is asserted as a *difference*, before and after, rather than as
 * a total. The seeded history already carries three weeks of recoveries at
 * this hospital, and a spec that pinned the total would be a spec about the
 * seed rather than about the tap that moved it. Specs run one at a time
 * (`workers: 1`), so nothing else offers a chair in between.
 */

import { expect, test, type Browser, type Page } from '@playwright/test';

import {
  adminToken,
  createConsoleSession,
  joinStandby,
  type ConsoleSession,
} from './support/console.js';
import { bengali, latin } from './support/digits.js';

const CONSOLE = 'http://localhost:3100';

let demo: ConsoleSession;

test.beforeEach(async () => {
  // Serial 2 at the front of an empty chamber, grace long run out. Each test
  // puts on the standby list whoever it needs.
  demo = await createConsoleSession(6, 'overdue');
});

async function openReception(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.addInitScript((token: string) => {
    window.sessionStorage.setItem(
      'console.demo-session',
      JSON.stringify({ token, hospitalId: 'e2e', staffName: 'E2E', role: 'receptionist' }),
    );
  }, demo.token);
  await page.goto(`${CONSOLE}/?session=${demo.sessionId}`);
  await expect(page.getByTestId('queue-table')).toBeVisible();
  return page;
}

async function openDashboard(browser: Browser): Promise<Page> {
  const token = await adminToken(demo.hospitalId);
  const page = await (await browser.newContext()).newPage();
  await page.addInitScript(
    ({ token: signed, hospitalId }: { token: string; hospitalId: string }) => {
      window.sessionStorage.setItem(
        'console.demo-session',
        JSON.stringify({ token: signed, hospitalId, staffName: 'E2E', role: 'hospital_admin' }),
      );
    },
    { token, hospitalId: demo.hospitalId },
  );
  await page.goto(`${CONSOLE}/?view=admin`);
  // The first read may rebuild the snapshot (`admin.service.ensureFresh`).
  await expect(page.getByTestId('admin-section-today')).toBeVisible({ timeout: 20_000 });
  return page;
}

/** The recovered tile, read back into poisha. */
async function recoveredPoisha(dashboard: Page): Promise<number> {
  await dashboard.getByTestId('admin-tab-loss').click();
  const text = await dashboard.getByTestId('admin-recovered-value').innerText();
  const taka = Number(latin(text).replace(/[^\d.]/g, ''));
  if (Number.isNaN(taka)) throw new Error(`unreadable recovered figure: ${text}`);
  return Math.round(taka * 100);
}

test.describe('a freed chair, recovered (FR-QUE-30, FR-REC-30, FR-ADM-03)', () => {
  test('no-show → offer → accept moves the dashboard by the chair’s fee', async ({ browser }) => {
    await joinStandby(demo, 2);
    const dashboard = await openDashboard(browser);
    const before = await recoveredPoisha(dashboard);

    const reception = await openReception(browser);

    // The card is there before anything is free, because people are waiting.
    const card = reception.getByTestId('standby-card');
    await expect(card).toBeVisible();
    await expect(reception.getByTestId('standby-waiting')).toContainText(bengali(2));

    // Serial 2 never came. Their grace period ran out an hour ago.
    await reception.getByTestId('queue-row-2').getByRole('button', { name: 'অনুপস্থিত' }).click();

    // The chair appears on the card, and its button goes live once the
    // no-show has reached the server — not before (`SLOT_NOT_FREE`).
    const offer = reception.getByTestId('standby-offer-2');
    await expect(offer).toBeEnabled({ timeout: 10_000 });
    await offer.click();

    // Offered to the top of the list, with the window it has to answer in.
    const pending = card.getByTestId('standby-pending');
    await expect(pending).toBeVisible({ timeout: 10_000 });
    await expect(pending).toContainText('উত্তরের অপেক্ষায়');

    // They rang the counter and said yes.
    await pending.getByRole('button', { name: 'গ্রহণ করেছেন' }).click();

    const accepted = card.getByTestId('standby-accepted');
    await expect(accepted).toBeVisible({ timeout: 10_000 });
    await expect(accepted).toContainText('ফেরত এসেছে');
    // Off the list: the person holding a chair is not still waiting for one.
    await expect(reception.getByTestId('standby-waiting')).toContainText(bengali(1));

    // The administrator's screen, in another browser, re-read. Loss and
    // recovery is a live view, not the five-minute snapshot, so the tap is
    // on it at once.
    await dashboard.reload();
    await expect(dashboard.getByTestId('admin-section-today')).toBeVisible({ timeout: 20_000 });
    const after = await recoveredPoisha(dashboard);

    expect(after - before).toBe(demo.feePoisha);
  });

  test('a chair with nobody on the list says so rather than offering', async ({ browser }) => {
    // The ordinary state of most chambers (`NO_STANDBY`). The chair is shown
    // as free, and the card says it stays empty — a sentence, not a button
    // that cannot be pressed.
    const reception = await openReception(browser);

    // Nothing is free and nobody waits, so there is no card at all yet.
    await expect(reception.getByTestId('standby-card')).toHaveCount(0);

    await reception.getByTestId('queue-row-2').getByRole('button', { name: 'অনুপস্থিত' }).click();

    const card = reception.getByTestId('standby-card');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('standby-freed')).toBeVisible();
    await expect(card.getByTestId('standby-no-one')).toBeVisible({ timeout: 10_000 });
    await expect(reception.getByTestId('standby-offer-2')).toHaveCount(0);
  });
});
