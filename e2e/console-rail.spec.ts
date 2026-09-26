/**
 * `e2e/console-rail.spec.ts` — the navigation rail (`APP_FLOW.md` B1.1).
 *
 * The rail used to be labels styled as a menu. Somebody exploring the demo
 * clicked বেড, জরুরি, টেস্ট in turn, nothing happened, and the console read as
 * broken. This spec clicks them the way that person did: every item either
 * opens its console for the same facility, or is switched off and says why.
 *
 * Opened through the picker throughout, for the reason
 * `admin-dashboard.spec.ts` gives: a console reached by writing a token into
 * storage proves nothing about whether a person can reach it.
 */

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const CONSOLE = 'http://localhost:3100';
const API = 'http://localhost:4000/api/v1';

interface Offer {
  readonly hospitalId: string;
  readonly roles: readonly string[];
  readonly sessions: readonly { readonly id: string }[];
}

/** What the picker offers, read the way the picker reads it. */
async function offers(request: APIRequestContext): Promise<readonly Offer[]> {
  const response = await request.get(`${API}/demo/consoles`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { data: { consoles: Offer[] } };
  return body.data.consoles;
}

function facilityWith(all: readonly Offer[], roles: readonly string[], chamber = false): Offer {
  const found = all.find(
    (entry) =>
      roles.every((role) => entry.roles.includes(role)) && (!chamber || entry.sessions.length > 0),
  );
  if (found === undefined) {
    throw new Error(`No seeded facility offers ${roles.join(', ')} (FR-DEM-01).`);
  }
  return found;
}

async function pick(page: Page, hospitalId: string): Promise<void> {
  await page.goto(CONSOLE);
  await expect(page.getByTestId('console-picker')).toBeVisible();
  await page.getByTestId(`pick-hospital-${hospitalId}`).click();
}

test.describe('the console rail (APP_FLOW.md B1.1)', () => {
  test('goes from a chamber to the ward and back to the same queue', async ({ page, request }) => {
    const facility = facilityWith(await offers(request), ['receptionist', 'ward'], true);
    const chamber = facility.sessions[0]?.id ?? '';

    await pick(page, facility.hospitalId);
    await page.getByTestId(`open-receptionist-${chamber}`).click();
    await expect(page).toHaveURL(new RegExp(`session=${chamber}`));
    await expect(page.getByTestId('chamber-title')).toBeVisible();
    const hospital = await page.getByTestId('rail-hospital').textContent();

    await page.getByTestId('rail-navBeds').click();
    await expect(page).toHaveURL(/view=ward/);
    await expect(page.getByTestId('ward-board')).toBeVisible();
    await expect(page.getByTestId('rail-hospital')).toHaveText(hospital ?? '');
    await expect(page.getByTestId('rail-navBeds')).toHaveAttribute('aria-current', 'page');

    await page.getByTestId('rail-navQueue').click();
    await expect(page).toHaveURL(new RegExp(`session=${chamber}`));
    await expect(page.getByTestId('chamber-title')).toBeVisible();
  });

  test("opens each of a facility's consoles in turn, for that facility", async ({
    page,
    request,
  }) => {
    const facility = facilityWith(await offers(request), [
      'ward',
      'emergency',
      'lab',
      'pharmacy',
      'hospital_admin',
    ]);

    await pick(page, facility.hospitalId);
    await page.getByTestId(`open-ward-${facility.hospitalId}`).click();
    await expect(page.getByTestId('ward-board')).toBeVisible();
    const hospital = (await page.getByTestId('rail-hospital').textContent()) ?? '';

    for (const [item, view, root] of [
      ['navEmergency', 'er', 'er-console'],
      ['navTests', 'lab', 'lab-console'],
      ['navBilling', 'pharmacy', 'pharmacy-console'],
    ] as const) {
      await page.getByTestId(`rail-${item}`).click();
      await expect(page).toHaveURL(new RegExp(`view=${view}`));
      await expect(page.getByTestId(root)).toBeVisible();
      await expect(page.getByTestId('rail-hospital')).toHaveText(hospital);
    }

    // The dashboard has no rail of its own; reaching it is the point.
    await page.getByTestId('rail-navDashboard').click();
    await expect(page).toHaveURL(/view=admin/);
    await expect(page.getByTestId('admin-dashboard')).toBeVisible({ timeout: 20_000 });
  });

  test('with no chamber opened yet, the queue item goes to the picker', async ({
    page,
    request,
  }) => {
    const facility = facilityWith(await offers(request), ['ward']);

    await pick(page, facility.hospitalId);
    await page.getByTestId(`open-ward-${facility.hospitalId}`).click();
    await expect(page.getByTestId('ward-board')).toBeVisible();

    await page.getByTestId('rail-navQueue').click();
    await expect(page.getByTestId('console-picker')).toBeVisible();
  });

  test('an item with nothing behind it is switched off and says why (FRONTEND.md §5.1)', async ({
    page,
    request,
  }) => {
    // A clinic: a pharmacy, and no ward, ER or lab.
    const all = await offers(request);
    const clinic = all.find(
      (entry) => entry.roles.includes('pharmacy') && !entry.roles.includes('ward'),
    );
    if (clinic === undefined) throw new Error('No seeded facility without a ward (FR-DEM-01).');

    await pick(page, clinic.hospitalId);
    await page.getByTestId(`open-pharmacy-${clinic.hospitalId}`).click();
    await expect(page.getByTestId('pharmacy-console')).toBeVisible();

    const beds = page.getByTestId('rail-navBeds');
    await expect(beds).toHaveAttribute('aria-disabled', 'true');
    await expect(beds).toContainText('এই প্রতিষ্ঠানে নেই');

    const registration = page.getByTestId('rail-navRegistration');
    await expect(registration).toHaveAttribute('aria-disabled', 'true');
    await expect(registration).toContainText('এই সংস্করণে নেই');

    await beds.click();
    await registration.click();
    await expect(page).toHaveURL(/view=pharmacy/);
    await expect(page.getByTestId('pharmacy-console')).toBeVisible();
  });
});
