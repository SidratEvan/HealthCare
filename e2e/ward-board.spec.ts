/**
 * `S-B-06` the ward board, and `S-A-11` the patient's bed search, together.
 *
 * Step 14's definition of done is "Capacity mirror matches public numbers"
 * (`CLAUDE.md` §4): what the ward's `<CapacityMirror>` says the app is showing
 * is what a family's phone is actually showing. So the first spec opens both
 * — the ward board in one browser context, the patient app in another — and
 * holds them to the same number before and after an admit.
 *
 * The rest walk the controls `APP_FLOW.md` B3 lists, a bed request from the
 * phone to the bed, and the ward's half of `FR-OFF-01`: bed changes made with
 * the network gone, queued, and sent in order when it returns.
 */

import { randomInt } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { admissionsIn, bedState, createWardFixture, type WardFixture } from './support/ward.js';

const CONSOLE = 'http://localhost:3100';
const PATIENT = 'http://localhost:3000';

let ward: WardFixture;

test.beforeEach(async () => {
  ward = await createWardFixture(3);
});

function bed(index: number): { readonly id: string; readonly label: string } {
  const found = ward.beds[index];
  if (found === undefined) throw new Error(`No fixture bed ${String(index)}`);
  return found;
}

/** A mobile number no seeded identity holds (`+88017…`, outside the seeds' `+88013…`). */
function phone(): string {
  return `017${String(randomInt(10_000_000, 99_999_999))}`;
}

async function openWardBoard(page: Page): Promise<void> {
  await page.addInitScript(
    ([token, hospitalId]) => {
      sessionStorage.setItem(
        'console.demo-session',
        JSON.stringify({ token, hospitalId, staffName: 'Ward (Demo)', role: 'ward' }),
      );
    },
    [ward.token, ward.hospitalId],
  );
  await page.goto(`${CONSOLE}/?view=ward`);
  await expect(page.getByTestId('ward-board')).toBeVisible();
  // The socket is up, so a change will be sent rather than queued.
  await expect(page.getByTestId('offline-block')).toHaveAttribute('data-connected', 'true', {
    timeout: 15_000,
  });
}

async function admitAtDesk(page: Page, label: string, name: string): Promise<void> {
  await page.getByTestId(`bed-tile-${label}`).click();
  await page.getByTestId('action-admit').click();
  await page.getByTestId('admit-name').fill(name);
  await page.getByTestId('admit-phone').fill(phone());
  await page.getByTestId('admit-age').fill('61');
  await page.getByTestId('admit-sex-male').click();
  await page.getByTestId('admit-confirm').click();
}

async function publishedGeneralFree(page: Page): Promise<number> {
  const mirror = page.getByTestId('mirror-general');
  await expect(mirror).toBeVisible();
  return Number(await mirror.getAttribute('data-published-free'));
}

test.describe('the mirror matches what the public is shown (FR-BED-06)', () => {
  test("the app shows the mirror's number, and both drop by one the moment a bed is taken", async ({
    page,
    browser,
  }) => {
    await openWardBoard(page);
    const before = await publishedGeneralFree(page);

    // The family's phone, in its own context — no staff token anywhere near it.
    const family = await browser.newContext();
    const app = await family.newPage();
    await app.goto(`${PATIENT}/beds?kind=general`);
    const card = app.getByTestId(`bed-card-${ward.hospitalId}`);
    await expect(card).toHaveAttribute('data-free', String(before));

    await admitAtDesk(page, bed(0).label, 'রাশেদুল করিম (ডেমো)');

    const tile = page.getByTestId(`bed-tile-${bed(0).label}`);
    await expect(tile).toHaveAttribute('data-state', 'occupied');
    // `APP_FLOW.md` B3: "public counters drop by one instantly".
    await expect(page.getByTestId('mirror-general')).toHaveAttribute(
      'data-published-free',
      String(before - 1),
    );

    // And the phone, read again, agrees with the ward's screen.
    await app.reload();
    await expect(card).toHaveAttribute('data-free', String(before - 1));

    await family.close();
  });
});

test.describe('S-B-06 the bed controls (APP_FLOW.md B3)', () => {
  test('a discharge goes to cleaning, and only "cleaning done" makes the bed free', async ({
    page,
  }) => {
    await openWardBoard(page);
    await admitAtDesk(page, bed(0).label, 'মমতাজ বেগম (ডেমো)');
    const tile = page.getByTestId(`bed-tile-${bed(0).label}`);
    await expect(tile).toHaveAttribute('data-state', 'occupied');

    await page.getByTestId('action-discharge').click();
    // GR-01: the confirmation names the consequence.
    await page.getByTestId('confirm-discharge').click();
    await expect(tile).toHaveAttribute('data-state', 'cleaning');
    await expect.poll(async () => await bedState(bed(0).id)).toBe('cleaning');

    await page.getByTestId('action-clean-done').click();
    await expect(tile).toHaveAttribute('data-state', 'free');
    await expect.poll(async () => await bedState(bed(0).id)).toBe('free');
  });

  test('a transfer moves the patient and sends the bed left for cleaning', async ({ page }) => {
    await openWardBoard(page);
    await admitAtDesk(page, bed(0).label, 'শাহানা পারভীন (ডেমো)');
    await expect(page.getByTestId(`bed-tile-${bed(0).label}`)).toHaveAttribute(
      'data-state',
      'occupied',
    );

    await page.getByTestId('action-transfer').click();
    await page.getByTestId(`transfer-to-${bed(1).label}`).click();
    await page.getByTestId('confirm-transfer').click();

    await expect(page.getByTestId(`bed-tile-${bed(0).label}`)).toHaveAttribute(
      'data-state',
      'cleaning',
    );
    await expect(page.getByTestId(`bed-tile-${bed(1).label}`)).toHaveAttribute(
      'data-state',
      'occupied',
    );
    await expect.poll(async () => await bedState(bed(1).id)).toBe('occupied');
  });

  test('a hold is one tap, and a broken bed says why', async ({ page }) => {
    await openWardBoard(page);

    await page.getByTestId(`bed-tile-${bed(2).label}`).click();
    await page.getByTestId('action-reserve-60').click();
    await expect(page.getByTestId(`bed-tile-${bed(2).label}`)).toHaveAttribute(
      'data-state',
      'reserved',
    );

    await page.getByTestId('action-release').click();
    await expect(page.getByTestId(`bed-tile-${bed(2).label}`)).toHaveAttribute(
      'data-state',
      'free',
    );

    await page.getByTestId('action-oos').click();
    await page.getByTestId('oos-reason').fill('অক্সিজেন লাইন মেরামত');
    await page.getByTestId('confirm-oos').click();
    const tile = page.getByTestId(`bed-tile-${bed(2).label}`);
    await expect(tile).toHaveAttribute('data-state', 'out_of_service');
    await expect(tile).toContainText('অক্সিজেন লাইন মেরামত');
  });
});

test.describe('a bed request, from the phone to the bed (FR-PAT-52, FR-BED-07)', () => {
  test('requested on the phone, held on the board, counted down on the phone, then admitted', async ({
    page,
    browser,
  }) => {
    const name = `হাবিবুর রহমান ${String(randomInt(100, 999))} (ডেমো)`;

    // The phone asks.
    const family = await browser.newContext();
    const app = await family.newPage();
    await app.goto(`${PATIENT}/beds?kind=general`);
    await app.getByTestId(`request-bed-${ward.hospitalId}`).click();
    const sheet = app.getByTestId('bed-request-sheet');
    await sheet.getByTestId('request-name').fill(name);
    await sheet.getByTestId('request-phone').fill(phone());
    await sheet.getByTestId('request-age').fill('47');
    await sheet.getByRole('button', { name: 'পুরুষ' }).click();
    await sheet.getByTestId('request-send').click();

    await expect(app.getByTestId('request-status')).toHaveAttribute('data-state', 'requested');

    // The ward sees it, and holds one of the fixture's general beds.
    await openWardBoard(page);
    const request = page.locator('article', { hasText: name });
    await expect(request).toBeVisible();
    await request.getByRole('button', { name: 'বেড রাখুন' }).click();
    await request.getByRole('button', { name: new RegExp(bed(0).label) }).click();
    await request.getByTestId('hold-for-60').click();

    await expect(page.getByTestId(`bed-tile-${bed(0).label}`)).toHaveAttribute(
      'data-state',
      'reserved',
    );
    await expect(request.getByTestId('pending-held')).toBeVisible();

    // The phone is told, with the time running.
    await app.reload();
    await expect(app.getByTestId('request-status')).toHaveAttribute('data-state', 'held');
    await expect(app.getByTestId('hold-left')).toBeVisible();

    // The family arrives.
    await request.getByRole('button', { name: 'ভর্তি করুন' }).click();
    await expect(page.getByTestId(`bed-tile-${bed(0).label}`)).toHaveAttribute(
      'data-state',
      'occupied',
    );

    await app.reload();
    await expect(app.getByTestId('request-status')).toHaveAttribute('data-state', 'confirmed');

    await family.close();
  });
});

test.describe('the ward keeps working offline (FR-OFF-01)', () => {
  test('an admit made offline is shown, counted, marked as not yet public, and sent on reconnect', async ({
    page,
    context,
  }) => {
    await openWardBoard(page);

    await context.setOffline(true);
    await expect(page.getByTestId('offline-block')).toHaveAttribute('data-connected', 'false', {
      timeout: 15_000,
    });

    await admitAtDesk(page, bed(0).label, 'নূরজাহান খাতুন (ডেমো)');

    const tile = page.getByTestId(`bed-tile-${bed(0).label}`);
    await expect(tile).toHaveAttribute('data-state', 'occupied');
    await expect(tile).toHaveAttribute('data-pending', 'true');
    await expect(page.getByTestId('pending-count')).toBeVisible();

    // FR-BED-06: the ward can see the public has not heard yet.
    const mirror = page.getByTestId('mirror-general');
    const published = Number(await mirror.getAttribute('data-published-free'));
    await expect(mirror).toHaveAttribute('data-board-free', String(published - 1));
    await expect(mirror.getByRole('status')).toBeVisible();

    // Nothing reached the server.
    expect(await bedState(bed(0).id)).toBe('free');

    await context.setOffline(false);
    await expect(page.getByTestId('offline-block')).toHaveAttribute('data-connected', 'true', {
      timeout: 20_000,
    });

    await expect(tile).toHaveAttribute('data-pending', 'false', { timeout: 20_000 });
    await expect.poll(async () => await bedState(bed(0).id), { timeout: 20_000 }).toBe('occupied');
    // Once, not twice: the replay is recognised by its event id (SY-02).
    expect(await admissionsIn(bed(0).id)).toBe(1);
    await expect(mirror).toHaveAttribute('data-published-free', String(published - 1));
  });
});

test.describe('the four states (GR-03)', () => {
  test('a board that cannot load says so and offers a retry', async ({ page }) => {
    await page.route('**/api/v1/hospitals/*/beds', (route) => route.abort());
    await page.addInitScript(
      ([token, hospitalId]) => {
        sessionStorage.setItem(
          'console.demo-session',
          JSON.stringify({ token, hospitalId, staffName: 'Ward (Demo)', role: 'ward' }),
        );
      },
      [ward.token, ward.hospitalId],
    );
    await page.goto(`${CONSOLE}/?view=ward`);

    await expect(page.getByTestId('board-failed')).toBeVisible();
    await expect(page.getByRole('button', { name: 'আবার চেষ্টা করুন' })).toBeVisible();
  });

  test('the picker offers the ward board for a hospital that runs a ward', async ({ page }) => {
    await page.goto(CONSOLE);
    await page.getByTestId(`pick-hospital-${ward.hospitalId}`).click();
    await page.getByTestId(`open-ward-${ward.hospitalId}`).click();

    await expect(page.getByTestId('ward-board')).toBeVisible();
    await expect(page).toHaveURL(/view=ward/);
  });
});
