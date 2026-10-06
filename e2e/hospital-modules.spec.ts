/**
 * A hospital runs the modules switched on for it (`PRD.md` `FR-BRD-11`,
 * `FR-SUP-03`; plan C4; `APP_FLOW.md` B7 `FRM-B12-MODULES`).
 *
 * The platform switches a module off on the hospital's workspace; the
 * hospital's consoles then offer nothing of it, and its settings say what is
 * off and how to get it back. What the API refuses and what stops being
 * published are held by `moduleRoutes.test.ts`; this is the screens.
 *
 * At Meghna, a diagnostic centre the seed gives a lab and no pharmacy shelf:
 * its pharmacy is off from the start (`seed_01_hospitals`). Whatever a test
 * switches, the seed's choice is put back through the platform's own route,
 * so that the API forgets what it remembered.
 */

import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';

import { signToken } from '../backend/api/src/config/jwt.js';

import { E2E_DATABASE_URL, assertLocalDatabase } from './support/database.js';

const CONSOLE = 'http://localhost:3100';
const API = 'http://localhost:4000/api/v1';

/** What the seed leaves off at Meghna. */
const SEEDED_OFF = ['pharmacy'];

let meghna: string;
let platformAdminId: string;

async function withClient<T>(body: (client: Client) => Promise<T>): Promise<T> {
  assertLocalDatabase();
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return await body(client);
  } finally {
    await client.end();
  }
}

/** The platform switches Meghna's modules, as its screen does. */
async function switchOff(off: readonly string[]): Promise<number> {
  const token = await signToken({
    kind: 'access',
    claims: { sub: platformAdminId, kind: 'staff', roles: ['platform_admin'] },
  });
  const response = await fetch(`${API}/platform/hospitals/${meghna}/modules`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
    },
    body: JSON.stringify({ off }),
  });
  return response.status;
}

test.beforeAll(async () => {
  await withClient(async (client) => {
    const hospital = await client.query<{ id: string }>(
      `SELECT id FROM hospitals WHERE code = 'MEGHNA'`,
    );
    const admin = await client.query<{ staff_user_id: string }>(
      `SELECT staff_user_id FROM staff_roles
        WHERE role = 'platform_admin' AND hospital_id IS NULL AND deleted_at IS NULL
        LIMIT 1`,
    );
    meghna = hospital.rows[0]?.id ?? '';
    platformAdminId = admin.rows[0]?.staff_user_id ?? '';
  });
  if (meghna === '' || platformAdminId === '') {
    throw new Error('The seed should hold Meghna and a platform administrator.');
  }
});

test.afterEach(async () => {
  expect(await switchOff(SEEDED_OFF)).toBe(200);
});

async function pickMeghna(page: Page): Promise<void> {
  await page.goto(CONSOLE);
  await expect(page.getByTestId('console-picker')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId(`pick-hospital-${meghna}`).click();
}

async function openWorkspace(page: Page): Promise<void> {
  await page.goto(CONSOLE);
  await expect(page.getByTestId('console-picker')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId('open-platform').click();
  await expect(page.getByTestId('platform-console')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('platform-row-MEGHNA').click();
  await expect(page.getByTestId('platform-modules')).toBeVisible();
}

test.describe('the platform switches a hospital’s modules (FR-SUP-03)', () => {
  test.setTimeout(120_000);

  test('switched off on the workspace, a module’s console is no longer offered; back on, it is', async ({
    page,
  }) => {
    // As the seed leaves it: a lab to open, and no pharmacy.
    await pickMeghna(page);
    await expect(page.getByTestId(`open-lab-${meghna}`)).toBeVisible();

    await openWorkspace(page);
    const chip = (module: string) => page.getByTestId(`platform-module-${module}`);
    await expect(chip('lab')).toHaveAttribute('aria-pressed', 'true');
    await expect(chip('beds')).toHaveAttribute('aria-pressed', 'true');
    await expect(chip('pharmacy')).toHaveAttribute('aria-pressed', 'false');
    // Nothing changed is nothing to save.
    await expect(page.getByTestId('platform-modules-save')).toBeDisabled();

    await chip('lab').click();
    await expect(chip('lab')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('platform-modules-save').click();
    await expect(page.getByTestId('platform-modules-save')).toBeDisabled();

    await pickMeghna(page);
    await expect(page.getByTestId(`open-admin-${meghna}`)).toBeVisible();
    await expect(page.getByTestId(`open-lab-${meghna}`)).toHaveCount(0);

    // Back on, from the same switches: the console is offered again.
    await openWorkspace(page);
    await expect(chip('lab')).toHaveAttribute('aria-pressed', 'false');
    await chip('lab').click();
    await page.getByTestId('platform-modules-save').click();
    await expect(page.getByTestId('platform-modules-save')).toBeDisabled();
    await pickMeghna(page);
    await expect(page.getByTestId(`open-lab-${meghna}`)).toBeVisible();
  });

  test('serials off takes the doctor’s console with it, where it can be seen', async ({ page }) => {
    await openWorkspace(page);
    const chip = (module: string) => page.getByTestId(`platform-module-${module}`);
    await expect(chip('queue')).toHaveAttribute('aria-pressed', 'true');
    await expect(chip('doctor')).toHaveAttribute('aria-pressed', 'true');

    await chip('queue').click();
    await expect(chip('queue')).toHaveAttribute('aria-pressed', 'false');
    await expect(chip('doctor')).toHaveAttribute('aria-pressed', 'false');

    // And the doctor's console back on brings serials with it.
    await chip('doctor').click();
    await expect(chip('doctor')).toHaveAttribute('aria-pressed', 'true');
    await expect(chip('queue')).toHaveAttribute('aria-pressed', 'true');
    // Back where it started: nothing to save.
    await expect(page.getByTestId('platform-modules-save')).toBeDisabled();
  });
});

test.describe('the hospital’s own settings follow (FR-BRD-11)', () => {
  test.setTimeout(120_000);

  test('no tab for a module that is off, and a line saying which are and whom to ask', async ({
    page,
  }) => {
    expect(await switchOff([...SEEDED_OFF, 'beds'])).toBe(200);
    await pickMeghna(page);
    await page.getByTestId(`open-admin-${meghna}`).click();
    await expect(page.getByTestId('admin-section-today')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('admin-open-settings').click();
    await expect(page.getByTestId('hospital-settings')).toBeVisible({ timeout: 30_000 });

    const said = page.getByTestId('settings-modules-off');
    await expect(said).toContainText('বেড');
    await expect(said).toContainText('ফার্মেসি');
    // Beds are off: no wards-and-beds tab. Emergency is on: its tab is there.
    await expect(page.getByTestId('settings-tab-beds')).toHaveCount(0);
    await expect(page.getByTestId('settings-tab-capabilities')).toBeVisible();
    await expect(page.getByTestId('settings-tab-doctors')).toBeVisible();
  });

  test('where the dashboard is off, the administrator still opens settings', async ({ page }) => {
    expect(await switchOff([...SEEDED_OFF, 'dashboard', 'import'])).toBe(200);

    await pickMeghna(page);
    const open = page.getByTestId(`open-admin-${meghna}`);
    await expect(open).toHaveText('সেটিংস খুলুন');
    await open.click();
    await expect(page.getByTestId('hospital-settings')).toBeVisible({ timeout: 30_000 });
    // No way from here into what is off.
    await expect(page.getByTestId('settings-back')).toHaveCount(0);
    await expect(page.getByTestId('settings-open-import')).toHaveCount(0);
    await expect(page.getByTestId('settings-modules-off')).toContainText('ড্যাশবোর্ড');
  });
});
