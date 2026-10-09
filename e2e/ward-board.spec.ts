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

import { closeOtherContexts } from './support/contexts.js';
import {
  admissionsIn,
  bedState,
  createWardFixture,
  randomTag,
  type WardFixture,
} from './support/ward.js';

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

// Second devices close after each test, or their pages poll the API for the
// rest of the run (`support/contexts.ts`).
test.afterEach(async ({ browser, context }) => {
  await closeOtherContexts(browser, context);
});

test.describe('the fixture these specs stand on', () => {
  test('a ward name that is already taken is not a failure: another is picked', async () => {
    // `beforeEach` has just made a ward. Its tag is in every bed's label
    // (`E3F9A-01`), and it is offered again here, twice, before a new one.
    const taken = bed(0).label.slice(1, 5);
    const offered = [taken, taken];

    const second = await createWardFixture(1, () => offered.shift() ?? randomTag());

    // The first CI run of this suite failed here with `wards_hospital_name_key`
    // (3 October): the fixture asked for a name that was taken and called it
    // an error. It now moves on to the next.
    expect(offered).toHaveLength(0);
    expect(second.wardName).not.toBe(ward.wardName);
    expect(second.beds).toHaveLength(1);
  });
});

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

  test('Esc backs out of a step, and then closes the panel (A11Y-05)', async ({ page }) => {
    await openWardBoard(page);

    await page.getByTestId(`bed-tile-${bed(1).label}`).click();
    await page.getByTestId('action-admit').click();
    await expect(page.getByTestId('admit-form')).toBeVisible();

    // One step back: the form goes, the bed stays open.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('admit-form')).toBeHidden();
    await expect(page.getByTestId('bed-actions')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('bed-panel')).toBeHidden();

    // Nothing was done to the bed on the way.
    await expect(page.getByTestId(`bed-tile-${bed(1).label}`)).toHaveAttribute(
      'data-state',
      'free',
    );
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

    // Wait for the navigation itself before asserting on the page it lands
    // on. Sending routes to `/beds/request?t=…`, and an expect() started
    // mid-navigation is racing it: `next dev` compiles that route on first
    // visit, which under a full suite run can take longer than the ten-second
    // expect timeout even though it is instant on its own. `waitForURL` has
    // the test's own budget and makes the wait explicit rather than implicit.
    await app.waitForURL(/\/beds\/request/);

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

test.describe('the ward outbox is kept on the device (FR-OFF-01)', () => {
  test('an admit that could not be sent survives a reload, and is sent once', async ({ page }) => {
    await openWardBoard(page);

    // The server cannot be reached for a bed action; the page itself loads.
    const blocked = '**/api/v1/beds/**';
    await page.route(blocked, async (route) => {
      if (route.request().method() === 'POST') await route.abort('connectionfailed');
      else await route.fallback();
    });

    // The page is reloaded only once the admit has been refused: one still
    // paused at the route when the page goes can slip through.
    const refused = page.waitForEvent(
      'requestfailed',
      (request) => request.method() === 'POST' && request.url().includes('/api/v1/beds/'),
    );
    await admitAtDesk(page, bed(0).label, 'সালমা বেগম (ডেমো)');
    await refused;
    const tile = page.getByTestId(`bed-tile-${bed(0).label}`);
    await expect(tile).toHaveAttribute('data-state', 'occupied');
    await expect(tile).toHaveAttribute('data-pending', 'true');
    await expect(page.getByTestId('pending-count')).toBeVisible();
    expect(await bedState(bed(0).id)).toBe('free');

    // The reload that used to lose it: the tile went back to free and the
    // patient was in a bed nobody had a record of.
    await page.reload();
    await expect(page.getByTestId('ward-board')).toBeVisible();
    await expect(tile).toHaveAttribute('data-state', 'occupied');
    await expect(tile).toHaveAttribute('data-pending', 'true');
    await expect(page.getByTestId('pending-count')).toBeVisible();
    expect(await bedState(bed(0).id)).toBe('free');

    // Reachable again; nobody taps anything.
    await page.unroute(blocked);
    await expect(tile).toHaveAttribute('data-pending', 'false', { timeout: 45_000 });
    await expect.poll(async () => await bedState(bed(0).id), { timeout: 20_000 }).toBe('occupied');

    // Once: nothing is left on the device to send a second time (`SY-02`).
    await page.reload();
    await expect(page.getByTestId('ward-board')).toBeVisible();
    await expect(tile).toHaveAttribute('data-state', 'occupied');
    await expect(page.getByTestId('pending-count')).toBeHidden();
    expect(await admissionsIn(bed(0).id)).toBe(1);
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

test.describe('one action, shown once, on the board (SY-09)', () => {
  /**
   * A bed's change is stated twice: in the answer to the request, and in a
   * broadcast. The board used to drop its own drawing when the answer came
   * and read the whole board again; for as long as that read took, the tile
   * showed the bed before the tap. Here the socket says nothing and the
   * re-read is not allowed at all, so the answer is everything the board has.
   */
  test('the socket silent: the tile settles from the answer and never shows the bed before', async ({
    page,
  }) => {
    let held = false;
    await page.routeWebSocket(/socket\.io/, (socket) => {
      const server = socket.connectToServer();
      socket.onMessage((message) => {
        server.send(message);
      });
      server.onMessage((message) => {
        if (!held) socket.send(message);
      });
    });

    await openWardBoard(page);
    const tile = page.getByTestId(`bed-tile-${bed(0).label}`);
    await expect(tile).toHaveAttribute('data-state', 'free');

    // Every state the tile shows from here on, in order.
    await page.evaluate((label) => {
      const read = (): string =>
        document.querySelector(`[data-testid="bed-tile-${label}"]`)?.getAttribute('data-state') ??
        '';
      const shown = [read()];
      new MutationObserver(() => {
        const now = read();
        if (now !== '' && now !== shown[shown.length - 1]) shown.push(now);
      }).observe(document.body, { subtree: true, childList: true, attributes: true });
      (globalThis as unknown as { states: string[] }).states = shown;
    }, bed(0).label);
    const states = async (): Promise<string[]> =>
      await page.evaluate(() => (globalThis as unknown as { states: string[] }).states);

    // From here the board cannot be read again, and the socket is silent.
    held = true;
    let reads = 0;
    await page.route(`**/hospitals/${ward.hospitalId}/beds`, async (route) => {
      reads += 1;
      await route.abort('failed');
    });

    const answered = page.waitForResponse(
      (response) => response.url().includes(`/beds/${bed(0).id}/admit`) && response.ok(),
    );
    await admitAtDesk(page, bed(0).label, 'আনোয়ারা বেগম (ডেমো)');
    await answered;

    // Nothing left to send, the bed is taken, and the public figure the
    // answer carried is on the mirror — all from the answer alone.
    await expect(page.getByTestId('pending-count')).toBeHidden();
    await expect(tile).toHaveAttribute('data-state', 'occupied');
    expect(await bedState(bed(0).id)).toBe('occupied');

    // It went from free to occupied and was never put back.
    expect(await states()).toEqual(['free', 'occupied']);
    // And the board did not need to ask again.
    expect(reads).toBe(0);
  });
});
