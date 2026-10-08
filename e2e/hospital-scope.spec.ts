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

/** The network's own primary in the patient app: Visual Direction 2's logo blue (FRONTEND.md §0.5, `PATIENT_COLOUR`). */
const PLATFORM_BRAND = '#0066dd';
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
  await page.getByTestId('home-search').click();
  await page.getByTestId('need-bed:icu').click();
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

// ---------------------------------------------------------------------------
// What a portal is, and is not (`FR-BRD-09`; plan C6)
// ---------------------------------------------------------------------------

const API = 'http://localhost:4000/api/v1';

/** A hospital's id from its code, as the public is told it. */
async function hospitalIdOf(code: string): Promise<string> {
  const response = await fetch(`${API}/config?scope=${code}`);
  const body = (await response.json()) as { data: { scope: { hospitalId: string } | null } };
  const id = body.data.scope?.hospitalId;
  if (id === undefined) throw new Error(`The seed should hold ${code} (FR-DEM-01).`);
  return id;
}

test('inside a portal the emergency search is still the whole network, and says so (FR-BRD-09)', async ({
  page,
}) => {
  const padma = await hospitalIdOf('PADMA');

  const asked = await fetch(`${API}/emergency/search?problem=accident`);
  const ranked = (
    (await asked.json()) as { data: { results: { hospitalId: string }[] } }
  ).data.results.map((entry) => entry.hospitalId);
  const other = ranked.find((id) => id !== padma);
  if (other === undefined) throw new Error('The seed should have more than one emergency desk.');

  // The network's own app: every hospital, and nothing to explain.
  await page.goto(`${PATIENT}/emergency/results?problem=accident&scope=`);
  await expect(page.getByTestId('results')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId(`result-${other}`)).toBeVisible();
  await expect(page.getByTestId('emergency-network-wide')).toHaveCount(0);

  // Padma's: the same search, not narrowed to Padma, with a line that says so.
  await page.goto(`${PATIENT}/emergency/results?problem=accident&scope=PADMA`);
  await expect(page.locator('html')).toHaveAttribute('data-scope', 'PADMA');
  await expect(page.getByTestId('results')).toBeVisible({ timeout: 45_000 });
  const line = page.getByTestId('emergency-network-wide');
  await expect(line).toBeVisible();
  await expect(line).toContainText('পদ্মা');
  await expect(line).toContainText('যুক্ত সব হাসপাতাল');
  // A hospital that is not the portal's own is on the screen.
  await expect(page.getByTestId(`result-${other}`)).toBeVisible();

  await page.goto(`${PATIENT}/?scope=`);
});

test('inside a portal the medicine search is that hospital’s pharmacy only (FR-BRD-09)', async ({
  page,
}) => {
  const karnaphuli = await hospitalIdOf('KARNAPHULI');
  const everywhere = await fetch(`${API}/medicines?q=para&limit=50`);
  const medicines = (
    (await everywhere.json()) as {
      data: { medicines: { genericName: string; pharmacies: { hospitalId: string }[] }[] };
    }
  ).data.medicines;
  const stocked = medicines.find(
    (entry) =>
      entry.pharmacies.some((p) => p.hospitalId === karnaphuli) && entry.pharmacies.length > 1,
  );
  if (stocked === undefined) {
    throw new Error('The seed should have a medicine at Karnaphuli and at another pharmacy.');
  }

  // The network's app names more than one pharmacy for it.
  await page.goto(`${PATIENT}/medicines`);
  await page.getByTestId('medicine-search').fill(stocked.genericName);
  await expect(page.getByTestId('medicine-list')).toBeVisible({ timeout: 45_000 });
  expect(await page.locator('[data-testid^="pharmacy-"]').count()).toBeGreaterThan(1);

  // Karnaphuli's names its own and no other, and says whose search this is.
  await page.goto(`${PATIENT}/medicines?scope=KARNAPHULI`);
  await expect(page.locator('html')).toHaveAttribute('data-scope', 'KARNAPHULI');
  await expect(page.getByTestId('medicines-intro')).toContainText('কর্ণফুলী');
  await page.getByTestId('medicine-search').fill(stocked.genericName);
  await expect(page.getByTestId('medicine-list')).toBeVisible({ timeout: 45_000 });
  const pharmacies = page.locator('[data-testid^="pharmacy-"]');
  await expect(pharmacies).toHaveCount(1);
  await expect(page.getByTestId(`pharmacy-${karnaphuli}`)).toBeVisible();
});

test('a portal’s first screen offers what its hospital runs, and the emergency card always', async ({
  page,
}) => {
  // The network's own app has all three.
  await page.goto(`${PATIENT}/?scope=`);
  await expect(page.getByTestId('emergency-card')).toBeVisible();
  await expect(page.getByTestId('quick-beds')).toBeVisible();
  await expect(page.getByTestId('quick-records')).toBeVisible();
  await expect(page.getByTestId('quick-medicines')).toBeVisible();

  // Meghna keeps no pharmacy shelf: no medicine search that could only answer nothing.
  await page.goto(`${PATIENT}/?scope=MEGHNA`);
  await expect(page.locator('html')).toHaveAttribute('data-scope', 'MEGHNA');
  await expect(page.getByTestId('quick-records')).toBeVisible();
  await expect(page.getByTestId('quick-beds')).toBeVisible();
  await expect(page.getByTestId('quick-medicines')).toHaveCount(0);
  await expect(page.getByTestId('emergency-card')).toBeVisible();

  // Buriganga runs no ward: no bed search. Its records and the emergency card stay.
  await page.goto(`${PATIENT}/?scope=BURIGANGA`);
  await expect(page.locator('html')).toHaveAttribute('data-scope', 'BURIGANGA');
  await expect(page.getByTestId('quick-records')).toBeVisible();
  await expect(page.getByTestId('quick-beds')).toHaveCount(0);
  await expect(page.getByTestId('quick-medicines')).toBeVisible();
  await expect(page.getByTestId('emergency-card')).toBeVisible();

  await page.goto(`${PATIENT}/?scope=`);
  await expect(page.getByTestId('quick-beds')).toBeVisible();
});
