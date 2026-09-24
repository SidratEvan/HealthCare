/**
 * `e2e/gov-dashboard.spec.ts` — `S-B-13`, step 20 (`FR-GOV-01`…`06`).
 *
 * The step's definition of done is "no identifiable row reachable". The API
 * suite proves it at the route and at the database (`gov.routes.test.ts`);
 * this proves it where a person would notice — on the screen and on the wire
 * the browser actually received — and walks the screen the way somebody
 * from a ministry would, through the picker.
 *
 * ## The figure a tap moves
 *
 * As step 19 did for the recovery figure, one test runs the whole chain
 * across two browsers: a doctor tags a visit ডেঙ্গু on `S-B-05` and signs
 * it, and the national screen's count for that district goes up by one. It is
 * asserted as a difference, because the seeded history already holds a
 * planted dengue week in Dhaka (`seed_09_signals`).
 */

import { expect, test, type Page } from '@playwright/test';

import { createConsoleSession } from './support/console.js';
import { districtOf, namesThatMustNotAppear } from './support/gov.js';

const CONSOLE = 'http://localhost:3100';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const BD_MOBILE = /(?:\+?88)?01[3-9]\d{8}/;

/** Opens `S-B-13` from the picker, the way a person would. */
async function openThroughPicker(page: Page): Promise<void> {
  await page.goto(CONSOLE);
  await expect(page.getByTestId('console-picker')).toBeVisible();

  const open = page.getByTestId('open-gov');
  await expect(open).toBeVisible();
  await open.click();

  await expect(page.getByTestId('gov-section-capacity')).toBeVisible({ timeout: 20_000 });
}

/** The "this week" count on one signal row, as the screen shows it. */
async function thisWeek(page: Page, district: string, signal: string): Promise<number> {
  const row = page.getByTestId(`gov-signal-${district}-${signal}`);
  await expect(row).toBeVisible();
  return Number(await row.locator('td').nth(2).innerText());
}

test.describe('the national dashboard (S-B-13)', () => {
  test('opens from the picker, labelled as a demo and as aggregate-only', async ({ page }) => {
    await openThroughPicker(page);

    await expect(page).toHaveURL(/view=gov/);
    await expect(page.getByText('এটি একটি ডেমো', { exact: false })).toBeVisible();
    await expect(page.getByTestId('gov-aggregate-only')).toBeVisible();
  });

  test('shows every section, each with its own age (CLAUDE.md §5.8)', async ({ page }) => {
    await openThroughPicker(page);

    for (const tab of ['capacity', 'er', 'signals', 'benchmarks']) {
      await page.getByTestId(`gov-tab-${tab}`).click();
      await expect(page.getByTestId(`gov-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');

      const section = page.getByTestId(`gov-section-${tab}`);
      await expect(section).toBeVisible();
      await expect(section.getByTestId('freshness').first()).toBeVisible();
    }
  });

  test('maps capacity by district, and says what nobody records (FR-GOV-01)', async ({ page }) => {
    await openThroughPicker(page);

    await expect(page.getByTestId('gov-beds-free-value')).toHaveText(/\d/);
    await expect(page.getByTestId('gov-district-Dhaka')).toContainText('ঢাকা');
    await expect(page.getByTestId('gov-district-Chattogram')).toBeVisible();
    // Ventilators and blood: said to be unrecorded, not shown as zero.
    await expect(page.getByTestId('gov-unrecorded')).toContainText('ভেন্টিলেটর');
  });

  test('draws the emergency load by district and hour (FR-GOV-02)', async ({ page }) => {
    await openThroughPicker(page);
    await page.getByTestId('gov-tab-er').click();

    const heat = page.getByTestId('gov-heatmap');
    await expect(heat).toBeVisible();
    // A district column, then twenty-four hours.
    await expect(heat.locator('thead th')).toHaveCount(25);
    await expect(page.getByTestId('gov-heat-Dhaka').locator('td')).toHaveCount(24);
  });

  test('flags the dengue rising in Dhaka, and nothing else (FR-GOV-03)', async ({ page }) => {
    await openThroughPicker(page);
    await page.getByTestId('gov-tab-signals').click();

    await expect(page.getByTestId('gov-spike-Dhaka-dengue')).toBeVisible();
    await expect(page.getByTestId('gov-signal-Dhaka-dengue')).toHaveAttribute(
      'data-status',
      'spike',
    );
    await expect(page.locator('[data-testid^="gov-spike-"]')).toHaveCount(1);
  });

  test('ranks facilities without naming one (FR-GOV-04)', async ({ page }) => {
    await openThroughPicker(page);
    await page.getByTestId('gov-tab-benchmarks').click();

    const wait = page.getByTestId('gov-measure-wait');
    await expect(wait).toBeVisible();
    await expect(wait.getByTestId('gov-bench-entry').first()).toBeVisible();

    const text = await page.getByTestId('gov-dashboard').innerText();
    for (const name of await namesThatMustNotAppear()) {
      expect(text, name).not.toContain(name);
    }
  });
});

test.describe('nothing identifying reaches the browser (FR-GOV-06)', () => {
  test('no id, phone or name in any response the screen received', async ({ page }) => {
    const bodies: string[] = [];
    page.on('response', async (response) => {
      if (response.url().includes('/api/v1/gov/')) bodies.push(await response.text());
    });

    await openThroughPicker(page);
    await expect.poll(() => bodies.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(4);

    const names = await namesThatMustNotAppear();
    for (const body of bodies) {
      expect(body).not.toMatch(UUID);
      expect(body).not.toMatch(BD_MOBILE);
      for (const name of names) expect(body, name).not.toContain(name);
    }
  });

  test('a government viewer cannot open a chamber by editing the URL', async ({ page }) => {
    const demo = await createConsoleSession(2);

    await openThroughPicker(page);
    await page.goto(`${CONSOLE}/?session=${demo.sessionId}`);

    // The principal is national, so the page offers the picker again rather
    // than a queue — and the API would refuse the queue if asked.
    await expect(page.getByTestId('console-picker')).toBeVisible();
    await expect(page.getByTestId('queue-table')).toHaveCount(0);
  });
});

test.describe('the figure a tap moves (FR-GOV-03, CHIP-B05-SIGNAL)', () => {
  test('a doctor tags a visit dengue, and the district count goes up by one', async ({
    browser,
  }) => {
    const demo = await createConsoleSession(4);
    const district = await districtOf(demo.hospitalId);

    const nationalContext = await browser.newContext();
    const national = await nationalContext.newPage();
    await openThroughPicker(national);
    await national.getByTestId('gov-tab-signals').click();
    const before = await thisWeek(national, district, 'dengue');

    const doctorContext = await browser.newContext();
    const doctor = await doctorContext.newPage();
    await doctor.addInitScript(
      ([token, hospitalId]) => {
        sessionStorage.setItem(
          'console.demo-session',
          JSON.stringify({ token, hospitalId, staffName: 'Doctor (Demo)', role: 'doctor' }),
        );
      },
      [demo.doctorToken, demo.hospitalId],
    );
    await doctor.goto(`${CONSOLE}/?session=${demo.sessionId}`);
    await expect(doctor.getByTestId('patient-panel')).toBeVisible();

    await doctor.getByTestId('visit-diagnosis').fill('ডেঙ্গু সন্দেহ');
    await doctor.getByTestId('visit-signal-dengue').click();
    await expect(doctor.getByTestId('visit-signal-dengue')).toHaveAttribute('aria-pressed', 'true');
    await doctor.getByTestId('sign-and-next').click();
    // Signed: the note clears for the next patient.
    await expect(doctor.getByTestId('visit-diagnosis')).toHaveValue('');
    // And the tag clears with it — the next patient is untagged until a
    // doctor says otherwise.
    await expect(doctor.getByTestId('visit-signal-none')).toHaveAttribute('aria-pressed', 'true');

    await national.reload();
    await national.getByTestId('gov-tab-signals').click();
    await expect.poll(() => thisWeek(national, district, 'dengue')).toBe(before + 1);

    await nationalContext.close();
    await doctorContext.close();
  });
});

test.describe('the four states (GR-03)', () => {
  test('keeps the last figures, with their ages, when the network goes', async ({
    page,
    context,
  }) => {
    // The screen re-reads every minute; the clock is what makes that minute
    // pass without the spec waiting for it.
    await page.clock.install();
    await openThroughPicker(page);
    const beds = await page.getByTestId('gov-beds-free-value').innerText();

    await context.setOffline(true);
    await page.clock.runFor(61_000);

    await expect(page.getByTestId('gov-offline-banner')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('gov-beds-free-value')).toHaveText(beds);
    await expect(
      page.getByTestId('gov-section-capacity').getByTestId('freshness').first(),
    ).toBeVisible();

    await context.setOffline(false);
  });
});
