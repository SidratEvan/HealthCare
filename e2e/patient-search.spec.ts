/**
 * `S-A-07s` — a patient says what they need and sees which hospitals can
 * provide it (`FR-PAT-16`–`18`, `PRD.md` §4.2b).
 *
 * The network's case in one spec: an ICU, a burn unit, a cardiologist and a
 * doctor by name, each answered across the seeded demo hospitals with a live
 * figure and its age, and each leading to the next step without searching
 * again.
 *
 * Seeded demo data (CLAUDE.md §6): six facilities, two with burn units
 * (Padma, Jamuna), three or more with an ICU.
 */

import { expect, test } from '@playwright/test';

const PATIENT = 'http://localhost:3000';

test.describe('the first screen asks what you need (S-A-02, FR-PAT-16)', () => {
  test('search is on Home, above the emergency card, and opens ready to type', async ({ page }) => {
    await page.goto(PATIENT);

    const search = page.getByTestId('home-search');
    const emergency = page.getByTestId('emergency-card');
    await expect(search).toBeVisible();
    await expect(emergency).toBeVisible();

    // Both on the first screenful of a phone (FRONTEND.md §6.3: the emergency
    // card is never below the fold).
    const viewport = page.viewportSize();
    const emergencyBox = await emergency.boundingBox();
    const searchBox = await search.boundingBox();
    expect(searchBox?.y ?? 0).toBeLessThan(emergencyBox?.y ?? 0);
    expect((emergencyBox?.y ?? 0) + (emergencyBox?.height ?? 0)).toBeLessThan(
      viewport?.height ?? 0,
    );

    await search.click();
    await expect(page).toHaveURL(/\/search$/);
    await expect(page.getByTestId('search-input')).toBeFocused();
    // Search is its own tab since Visual Direction 2 (`NAV-A`, 2026-10-07).
    // `/search` begins with `/s`, the live serial's route, and once lit the
    // serials tab instead.
    await expect(page.getByTestId('nav-search')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('nav-serials')).not.toHaveAttribute('aria-current', 'page');
    // Every need the network answers is offered before a letter is typed.
    await expect(page.getByTestId('search-needs')).toBeVisible();
    await expect(page.getByTestId('need-bed:icu')).toBeVisible();
    await expect(page.getByTestId('need-capability:burn_unit')).toBeVisible();
    await expect(page.getByTestId('need-specialty:CARD')).toBeVisible();
  });

  test('from Home, a need is one tap past the search field', async ({ page }) => {
    // The quick needs moved from Home to the search screen on 2026-10-07
    // (APP_FLOW.md S-A-02): Home keeps one way to ask.
    await page.goto(PATIENT);
    await page.getByTestId('home-search').click();
    await page.getByTestId('need-bed:icu').click();

    await expect(page).toHaveURL(/need=bed%3Aicu/);
    await expect(page.getByTestId('search-results')).toBeVisible();
    await expect(page.getByTestId('search-need')).toContainText('আইসিইউ');
  });
});

test.describe('a need answers with hospitals and a live figure (FR-PAT-17)', () => {
  test('an ICU: every hospital that has one, with free and total and how old the count is', async ({
    page,
  }) => {
    await page.goto(`${PATIENT}/search?need=bed:icu`);

    const results = page.getByTestId('search-results');
    await expect(results).toBeVisible();

    const lines = results.getByTestId('result-need-line');
    expect(await lines.count()).toBeGreaterThanOrEqual(3);
    // FR-PAT-14: the figure and, under it, its age. Bangla digits, no Latin.
    await expect(lines.first()).toContainText('আইসিইউ');
    const age = lines.first().getByTestId('freshness');
    await expect(age).toBeVisible();
    // A count only while it is fresh (owner, 8 October; FR-PAT-14). The seed
    // stamps each ward minutes before the suite reaches here, so the line may
    // be either side of the threshold: each side is held to its own rule.
    if ((await age.getAttribute('data-stale')) === 'true') {
      await expect(lines.first()).toContainText('আইসিইউ বেডের খবর জানা নেই');
      await expect(lines.first()).not.toContainText(/খালি [০-৯]+, মোট/);
    } else {
      await expect(lines.first()).toContainText(/খালি [০-৯]+, মোট [০-৯]+/);
    }

    // A bed search does not list doctors, and its step is the bed request.
    await expect(results.getByText('ডাক্তার', { exact: true })).toHaveCount(0);
    await results.locator('a[href="/beds?kind=icu"]').first().click();
    await expect(page.getByTestId('bed-search')).toBeVisible();
  });

  test('a burn unit, typed in English: the two hospitals that have one, and their number', async ({
    page,
  }) => {
    await page.goto(`${PATIENT}/search`);
    await page.getByTestId('search-input').fill('burn');

    const results = page.getByTestId('search-results');
    await expect(results).toBeVisible();
    await expect(results).toContainText('বার্ন ইউনিট');

    const hospitals = results.locator('[data-testid^="result-hospital-"]');
    await expect(hospitals).toHaveCount(2);
    await expect(results).toContainText('পদ্মা');
    await expect(results).toContainText('যমুনা');

    // An emergency's question: the capability, when it was confirmed, and the
    // number to ring, all on the card.
    await expect(results.getByTestId('result-need-line').first()).toContainText('আছে');
    await expect(results.locator('a[href^="tel:"]').first()).toBeVisible();
  });

  test('typing offers the need it could be the start of', async ({ page }) => {
    await page.goto(`${PATIENT}/search`);
    await page.getByTestId('search-input').fill('dia');

    const offered = page.getByTestId('search-suggestions');
    await expect(offered.getByTestId('need-capability:dialysis')).toBeVisible();

    await offered.getByTestId('need-capability:dialysis').click();
    await expect(page.getByTestId('search-need')).toContainText('লাইসিস');
    await expect(page.getByTestId('search-input')).toHaveValue('');
    await expect(page.getByTestId('search-results')).toBeVisible();
  });

  test('a cardiologist: hospitals with doctors and open serials, and on to that hospital’s doctors', async ({
    page,
  }) => {
    await page.goto(`${PATIENT}/search`);
    await page.getByTestId('need-specialty:CARD').click();

    const results = page.getByTestId('search-results');
    await expect(results).toBeVisible();
    // Doctors first for a specialty (`S-A-07s`, 2026-10-07); the hospitals
    // offering it are the other side of the switch.
    await results.getByTestId('search-tab-hospitals').click();
    await expect(results.getByTestId('result-chamber-line').first()).toContainText('জন ডাক্তার');

    // The hospital is already chosen, so booking opens on its doctors.
    await results.locator('[data-testid^="result-open-"]').first().click();
    await expect(page).toHaveURL(/\/book\?specialty=CARD&hospital=/);
    await expect(page.locator('[data-testid^="doctor-"]').first()).toBeVisible();
    await expect(page.locator('[data-testid^="hospital-"]')).toHaveCount(0);
  });
});

test.describe('names (FR-PAT-16)', () => {
  test('a doctor by name, and from the result straight to their chamber times', async ({
    page,
  }) => {
    await page.goto(`${PATIENT}/search`);
    await page.getByTestId('search-input').fill('Ayesha');

    const doctor = page.locator('[data-testid^="result-doctor-"]').first();
    await expect(doctor).toBeVisible();
    await expect(doctor).toContainText('সিদ্দিকা');

    // Hospital and doctor are both known: the flow opens on the sessions.
    await doctor.locator('[data-testid^="result-chamber-"]').first().click();
    await expect(page).toHaveURL(/\/book\?specialty=[A-Z]+&hospital=.+&doctor=/);
    await expect(page.locator('[data-testid^="session-"]').first()).toBeVisible();
  });

  test('a hospital by name in Bangla, and on to every doctor there', async ({ page }) => {
    await page.goto(`${PATIENT}/search`);
    await page.getByTestId('search-input').fill('শাপলা');

    const hospital = page.locator('[data-testid^="result-hospital-"]').first();
    await expect(hospital).toBeVisible();
    await expect(hospital).toContainText('শাপলা');

    await hospital.locator('[data-testid^="result-open-"]').click();
    await expect(page).toHaveURL(/\/book\?hospital=/);
    await expect(page.locator('[data-testid^="doctor-"]').first()).toBeVisible();
  });
});

test.describe('the other three states (GR-03, FR-PAT-18)', () => {
  test('a name nobody has says so, in words that are not the failure’s', async ({ page }) => {
    await page.goto(`${PATIENT}/search`);
    await page.getByTestId('search-input').fill('zzzzqqqq');

    await expect(page.getByTestId('search-empty')).toContainText('zzzzqqqq');
    await expect(page.getByTestId('search-failed')).toHaveCount(0);
  });

  test('a search that fails says it failed and can be tried again', async ({ page }) => {
    let fail = true;
    await page.route('**/api/v1/search**', async (route) => {
      if (fail) await route.abort();
      else await route.continue();
    });

    await page.goto(`${PATIENT}/search?need=bed:icu`);
    await expect(page.getByTestId('search-failed')).toBeVisible();
    // Not "no hospital has it": that would be a statement about hospitals
    // standing in for a statement about the network (PRD §3.2).
    await expect(page.getByTestId('search-empty')).toHaveCount(0);

    fail = false;
    await page.getByTestId('search-failed').getByRole('button').click();
    await expect(page.getByTestId('search-results')).toBeVisible();
  });

  test('offline, it says a search needs a connection', async ({ page, context }) => {
    await page.goto(`${PATIENT}/search`);
    await expect(page.getByTestId('search-needs')).toBeVisible();

    await context.setOffline(true);
    await expect(page.getByTestId('search-offline')).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByTestId('search-offline')).toHaveCount(0);
  });
});
