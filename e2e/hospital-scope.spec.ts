/**
 * The patient app opened for one hospital (`FR-BRD-02`, `FR-BRD-03`,
 * `FR-PAT-19`).
 *
 * What a hospital-branded patient app is, shown with the one build there is:
 * the same app with a scope. It says whose it is, wears that hospital's
 * colours, and shows that hospital's doctors and beds and nobody else's.
 * Leaving the scope gives the network back.
 *
 * Seeded demo data (CLAUDE.md §6): Padma has colours of its own, a navy ramp;
 * every other facility appears in the platform's green.
 */

import { expect, test, type Page } from '@playwright/test';

const PATIENT = 'http://localhost:3000';

const PLATFORM_BRAND = '#0c5c46';
const PADMA_BRAND = '#17507f';

async function brand600(page: Page): Promise<string> {
  return await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--brand-600').trim(),
  );
}

test('the network’s own app is nobody’s, in the platform’s colours', async ({ page }) => {
  await page.goto(PATIENT);

  await expect(page.getByTestId('app-name')).toHaveText('MedLiveBD');
  expect(await brand600(page)).toBe(PLATFORM_BRAND);
  await expect(page.locator('html')).not.toHaveAttribute('data-scope', /.+/);
});

test('opened for Padma, it is Padma’s: its name, its colours, its hospital only', async ({
  page,
}) => {
  await page.goto(`${PATIENT}/?scope=PADMA`);

  // Whose app it is (FR-PAT-19).
  await expect(page.getByTestId('app-name')).toContainText('পদ্মা');
  await expect(page.locator('html')).toHaveAttribute('data-scope', 'PADMA');
  // Its colours, from configuration (FR-BRD-03).
  await expect.poll(async () => await brand600(page)).toBe(PADMA_BRAND);

  // The scope outlives the link: the next screen is still Padma's.
  await page.getByTestId('home-need-bed:icu').click();
  const results = page.getByTestId('search-results');
  await expect(results).toBeVisible();
  await expect(page.getByTestId('search-intro')).toContainText('পদ্মা');

  const hospitals = results.locator('[data-testid^="result-hospital-"]');
  await expect(hospitals).toHaveCount(1);
  await expect(hospitals.first()).toContainText('পদ্মা');
  expect(await brand600(page)).toBe(PADMA_BRAND);
});

test('in scope, another hospital cannot be found by name, and booking is this hospital’s', async ({
  page,
}) => {
  await page.goto(`${PATIENT}/search?scope=PADMA`);

  await page.getByTestId('search-input').fill('শাপলা');
  await expect(page.getByTestId('search-empty')).toBeVisible();

  // A specialty leads to Padma's doctors and to no list of other hospitals.
  await page.goto(`${PATIENT}/book?specialty=CARD`);
  const places = page.locator('[data-testid^="hospital-"]');
  await expect(places).toHaveCount(1);
  await expect(places.first()).toContainText('পদ্মা');
});

test('a hospital’s own app shows that hospital’s serials, not another hospital’s (FR-BRD-02)', async ({
  page,
}) => {
  // The serial below is a stand-in with no real link behind it, so its
  // status cannot be asked. It is then "unknown", which keeps a serial on
  // screen rather than filing it as past (`FR-PAT-39`) — what this test
  // needs, since it is about whose serial is shown, not about its status.
  await page.route('**/guest/link/**', async (route) => {
    await route.abort('failed');
  });

  // What this phone holds: a serial today at some other hospital.
  await page.goto(PATIENT);
  await page.evaluate(() => {
    globalThis.localStorage.setItem(
      'patient.bookings',
      JSON.stringify([
        {
          bookingId: '00000000-0000-7000-8000-000000000001',
          serial: 7,
          sessionId: '00000000-0000-7000-8000-000000000002',
          doctorNameBn: 'ডা. অন্য (ডেমো)',
          hospitalNameBn: 'অন্য হাসপাতাল (ডেমো)',
          hospitalId: '00000000-0000-7000-8000-000000000003',
          plannedStart: new Date().toISOString(),
          url: '/s?b=x&t=y',
          token: 'not-a-real-token',
          savedAt: new Date().toISOString(),
        },
      ]),
    );
  });

  // The network's own app shows it: it is this phone's serial.
  await page.goto(PATIENT);
  await expect(page.getByTestId('active-serial')).toBeVisible();

  // Padma's app does not, on Home or in the list.
  await page.goto(`${PATIENT}/?scope=PADMA`);
  await expect(page.getByTestId('app-name')).toContainText('পদ্মা');
  await expect(page.getByTestId('active-serial')).toHaveCount(0);
  await page.goto(`${PATIENT}/serials`);
  await expect(page.getByTestId('serials-empty')).toBeVisible();

  await page.goto(`${PATIENT}/?scope=`);
  await expect(page.getByTestId('active-serial')).toBeVisible();
});

test('leaving the scope gives the network back', async ({ page }) => {
  await page.goto(`${PATIENT}/?scope=PADMA`);
  await expect(page.getByTestId('app-name')).toContainText('পদ্মা');

  await page.goto(`${PATIENT}/?scope=`);
  await expect(page.getByTestId('app-name')).toHaveText('MedLiveBD');
  expect(await brand600(page)).toBe(PLATFORM_BRAND);

  await page.goto(`${PATIENT}/search?need=bed:icu`);
  const results = page.getByTestId('search-results');
  await expect(results).toBeVisible();
  // More than one: the list is the network's again.
  await expect(results.locator('[data-testid^="result-hospital-"]').nth(1)).toBeVisible();
});

test('a code no hospital has shows the network, not somebody else’s app', async ({ page }) => {
  // The server refuses the code (404), so nothing is scoped and nothing is
  // themed. What the screens then ask for is refused too, and they say so.
  await page.goto(`${PATIENT}/?scope=NOSUCH`);

  await expect(page.getByTestId('app-name')).toHaveText('MedLiveBD');
  expect(await brand600(page)).toBe(PLATFORM_BRAND);

  await page.goto(`${PATIENT}/search?need=bed:icu`);
  await expect(page.getByTestId('search-failed')).toBeVisible();
});
