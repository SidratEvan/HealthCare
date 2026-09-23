/**
 * `e2e/admin-dashboard.spec.ts` — `S-B-10`, step 19 (`FR-ADM-01`…`10`).
 *
 * The recovery figure moving is `no-show-recovery.spec.ts`. This file is the
 * screen itself: opened the way a person opens it, every section present with
 * its own age, the adoption marker on the trend, an export that downloads,
 * and the offline state.
 *
 * ## Through the picker, on purpose
 *
 * Twice now a console has been built and been unreachable: the ER role at
 * step 15 and the lab and pharmacy at step 17, each because its spec wrote a
 * token straight into storage and never went through `S-B-01`. This spec
 * opens the dashboard by tapping the picker, so a role the picker does not
 * offer fails here rather than in front of somebody.
 */

import { expect, test, type Page } from '@playwright/test';

const CONSOLE = 'http://localhost:3100';

/** Opens `S-B-10` for the picker's first hospital, the way a person would. */
async function openThroughPicker(page: Page): Promise<void> {
  await page.goto(CONSOLE);
  await expect(page.getByTestId('console-picker')).toBeVisible();

  const open = page.locator('[data-testid^="open-admin-"]').first();
  await expect(open).toBeVisible();
  await open.click();

  // The first read may rebuild the snapshot (`admin.service.ensureFresh`).
  await expect(page.getByTestId('admin-section-today')).toBeVisible({ timeout: 20_000 });
}

test.describe('the hospital dashboard (S-B-10)', () => {
  test('opens from the picker, on the overview, labelled as a demo', async ({ page }) => {
    await openThroughPicker(page);

    await expect(page).toHaveURL(/view=admin/);
    await expect(page.getByText('এটি একটি ডেমো', { exact: false })).toBeVisible();

    // FR-ADM-01 names average wait, which nothing measures. The screen says
    // so instead of showing a zero, and gives the figure that is real.
    await expect(page.getByTestId('admin-wait-notice')).toBeVisible();
    await expect(page.getByTestId('admin-seen-value')).toHaveText(/\d/);
  });

  test('shows every section, each with its own age (CLAUDE.md §5.8)', async ({ page }) => {
    await openThroughPicker(page);

    for (const tab of [
      'today',
      'trend',
      'loss',
      'revenue',
      'staff',
      'beds',
      'referrals',
      'feedback',
      'forecast',
    ]) {
      await page.getByTestId(`admin-tab-${tab}`).click();
      await expect(page.getByTestId(`admin-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');

      const section = page.getByTestId(`admin-section-${tab}`);
      await expect(section).toBeVisible();
      await expect(section.getByTestId('freshness')).toBeVisible();
    }
  });

  test('marks the live-queue adoption date on the trend (FR-ADM-02)', async ({ page }) => {
    await openThroughPicker(page);
    await page.getByTestId('admin-tab-trend').click();

    const section = page.getByTestId('admin-section-trend');
    await expect(section.locator('svg.recharts-surface')).toBeVisible();
    await expect(section.getByText('লাইভ সিরিয়াল চালু')).toBeVisible();
  });

  test('downloads the section on screen as CSV (FR-ADM-10)', async ({ page }) => {
    await openThroughPicker(page);
    await page.getByTestId('admin-tab-loss').click();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('admin-export').click(),
    ]);

    expect(download.suggestedFilename()).toMatch(
      /^loss-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/,
    );
  });

  test('keeps the last figures, with their ages, when the network goes', async ({
    page,
    context,
  }) => {
    await openThroughPicker(page);
    await page.getByTestId('admin-tab-loss').click();
    const recovered = await page.getByTestId('admin-recovered-value').innerText();

    await context.setOffline(true);
    // A new range needs the server; the one on screen stays.
    await page.getByRole('button', { name: 'গত ৭ দিন' }).click();

    await expect(page.getByTestId('admin-offline-banner')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('admin-recovered-value')).toHaveText(recovered);
    await expect(page.getByTestId('admin-section-loss').getByTestId('freshness')).toBeVisible();
    // The export says it needs a connection rather than failing on a tap.
    await expect(page.getByTestId('admin-export')).toBeDisabled();

    await context.setOffline(false);
  });
});

test.describe('the picker offers every hospital console that is built', () => {
  test('the lab and the pharmacy are offered where they are staffed (S-B-08, S-B-09)', async ({
    page,
  }) => {
    // Regression: from step 17 until step 19 neither was ever offered.
    await page.goto(CONSOLE);
    await expect(page.getByTestId('console-picker')).toBeVisible();

    const hospitals = page.locator('[data-testid^="pick-hospital-"]');
    await expect(hospitals.first()).toBeVisible();
    const count = await hospitals.count();

    let lab = false;
    let pharmacy = false;
    for (let index = 0; index < count; index += 1) {
      await hospitals.nth(index).click();
      lab ||= (await page.locator('[data-testid^="open-lab-"]').count()) > 0;
      pharmacy ||= (await page.locator('[data-testid^="open-pharmacy-"]').count()) > 0;
      await expect(page.locator('[data-testid^="open-admin-"]')).toHaveCount(1);
    }

    expect(lab).toBe(true);
    expect(pharmacy).toBe(true);
  });
});
