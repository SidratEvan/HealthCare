/**
 * How a hospital is doing, and what was done to it, on the platform's screen
 * (`PRD.md` `FR-SUP-06`, `FR-ONB-07`; plan G2; `APP_FLOW.md` B7
 * `TXT-B12-HEALTH`, `LIST-B12-TRAIL`).
 *
 * The list says which hospital needs attention; an opened workspace says how
 * old its published figures are, what became of a week's messages and how
 * much of its counters' work arrived late; and its trail says who did what.
 * Who may read it, what is flagged and that no patient is in it are held by
 * `platformHealth.routes.test.ts`; this is the screen.
 *
 * Karnaphuli is the seed's hospital with a poor line: late work and a few
 * failed messages (`seed_04_history`). The other five have neither.
 */

import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';

import { signToken } from '../backend/api/src/config/jwt.js';

import { E2E_DATABASE_URL, assertLocalDatabase } from './support/database.js';

const CONSOLE = 'http://localhost:3100';
const API = 'http://localhost:4000/api/v1';

let shapla: string;
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

/** Puts Shapla's agreement back as the seed leaves it. */
async function restoreAgreement(): Promise<number> {
  const token = await signToken({
    kind: 'access',
    claims: { sub: platformAdminId, kind: 'staff', roles: ['platform_admin'] },
  });
  const response = await fetch(`${API}/platform/hospitals/${shapla}/agreement`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
    },
    body: JSON.stringify({ state: 'active', note: null }),
  });
  return response.status;
}

test.beforeAll(async () => {
  await withClient(async (client) => {
    const hospital = await client.query<{ id: string }>(
      `SELECT id FROM hospitals WHERE code = 'SHAPLA'`,
    );
    const admin = await client.query<{ staff_user_id: string }>(
      `SELECT staff_user_id FROM staff_roles
        WHERE role = 'platform_admin' AND hospital_id IS NULL AND deleted_at IS NULL
        LIMIT 1`,
    );
    shapla = hospital.rows[0]?.id ?? '';
    platformAdminId = admin.rows[0]?.staff_user_id ?? '';
  });
  if (shapla === '' || platformAdminId === '') {
    throw new Error('The seed should hold Shapla and a platform administrator.');
  }
});

async function openPlatform(page: Page): Promise<void> {
  await page.goto(CONSOLE);
  await expect(page.getByTestId('console-picker')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId('open-platform').click();
  await expect(page.getByTestId('platform-console')).toBeVisible({ timeout: 30_000 });
}

async function openWorkspace(page: Page, code: string): Promise<void> {
  await page.getByTestId(`platform-row-${code}`).click();
  await expect(page.getByTestId('platform-health')).toBeVisible();
}

test.describe('how a hospital is doing (FR-SUP-06)', () => {
  test.setTimeout(120_000);

  test('the list says which hospital needs attention, and its workspace says why', async ({
    page,
  }) => {
    await openPlatform(page);
    // Karnaphuli's provider failed a few messages; Shapla's did not.
    await expect(
      page.getByTestId('platform-row-KARNAPHULI').getByTestId('platform-row-attention-messages'),
    ).toHaveText('বার্তা যায়নি');
    await expect(
      page.getByTestId('platform-row-SHAPLA').getByTestId('platform-row-attention-messages'),
    ).toHaveCount(0);
    // The stale-data offenders: an age on the row, to read one against another,
    // and not a flag. The seed leaves Jamuna's bed counts and Karnaphuli's
    // emergency declarations hours old; a hospital whose figures were all
    // touched in the last few minutes has no such line, which is why Shapla,
    // fresh from the reset, is not asked about here.
    for (const code of ['JAMUNA', 'KARNAPHULI']) {
      const line = page.getByTestId(`platform-row-${code}`).getByTestId('platform-row-stalest');
      await expect(line).toContainText('সবচেয়ে পুরোনো প্রকাশিত তথ্য');
      await expect(line).toContainText('ঘণ্টা');
    }
    await expect(page.getByTestId('platform-row-attention-unconfirmed_figures')).toHaveCount(0);

    await openWorkspace(page, 'KARNAPHULI');
    const health = page.getByTestId('platform-health');
    await expect(health).toHaveAttribute('data-attention', /messages/);
    // A week's messages by what became of them.
    await expect(page.getByTestId('platform-health-sent')).not.toHaveText('০');
    await expect(page.getByTestId('platform-health-failed')).not.toHaveText('০');
    // Work that arrived late, said as work and not as a fault.
    await expect(page.getByTestId('platform-health-late')).not.toHaveText('০');
    // Each figure it publishes, with its age.
    await expect(page.getByTestId('platform-health-figure-beds')).toBeVisible();
    await expect(page.getByTestId('platform-health-figure-capabilities')).toBeVisible();
    // A live figure says how old it is.
    await expect(health.getByTestId('freshness')).toBeVisible();
  });

  test('a hospital with nothing wrong in its messages or its sync says so in sentences', async ({
    page,
  }) => {
    // Meghna, a diagnostic centre no other spec runs a chamber at: what the
    // seed left there is what is there.
    await openPlatform(page);
    await openWorkspace(page, 'MEGHNA');
    await expect(page.getByTestId('platform-health-failed')).toHaveText('০');
    await expect(page.getByTestId('platform-health-sent')).not.toHaveText('০');
    await expect(page.getByTestId('platform-health-late')).toHaveCount(0);
    await expect(page.getByTestId('platform-health-sync')).toContainText(
      'এই সময়ে কোনো কাজ দেরিতে পৌঁছায়নি।',
    );
    await expect(page.getByTestId('platform-health')).not.toHaveAttribute(
      'data-attention',
      /messages/,
    );
  });

  test('a clinic with no ward has no bed figure to be stale', async ({ page }) => {
    await openPlatform(page);
    await openWorkspace(page, 'BURIGANGA');
    await expect(page.getByTestId('platform-health-figure-beds')).toHaveCount(0);
  });
});

test.describe('what was done to a hospital (FR-ONB-07)', () => {
  test.setTimeout(120_000);

  test.afterEach(async () => {
    expect(await restoreAgreement()).toBe(200);
  });

  test('the trail is asked for, and a change made on this screen is its first line', async ({
    page,
  }) => {
    await openPlatform(page);
    await openWorkspace(page, 'SHAPLA');

    // Not loaded until asked for.
    await expect(page.getByTestId('platform-trail-list')).toHaveCount(0);
    await page.getByTestId('platform-trail-show').click();
    const trail = page.getByTestId('platform-trail-list');
    await expect(trail).toBeVisible();
    // How it was brought on: approved by the platform, set up by its own administrator.
    await expect(trail.locator('[data-change="workspace_approve"]')).toContainText('প্ল্যাটফর্ম');
    // The oldest lines are a tap away, not drawn until asked for.
    await expect(trail.locator('[data-change="workspace_created"]')).toHaveCount(0);
    await page.getByTestId('platform-trail-more').click();
    await expect(trail.locator('[data-change="workspace_created"]')).toBeVisible();
    await expect(trail.locator('[data-change="department_added"]')).toContainText('হাসপাতাল');

    // The platform marks the agreement overdue, on the same panel.
    await page.getByTestId('platform-agreement-overdue').click();
    await page.getByTestId('platform-agreement-save').click();
    await expect(page.getByTestId('platform-agreement')).toHaveAttribute(
      'data-agreement',
      'overdue',
    );

    // The trail on show is read again: what was just done, who by, and whose side.
    const first = page.getByTestId('platform-trail-entry').first();
    await expect(first).toHaveAttribute('data-change', 'agreement_overdue');
    await expect(first).toContainText('চুক্তির অবস্থা: বকেয়া');
    await expect(first).toContainText('প্ল্যাটফর্ম');
    await expect(first).toContainText('(ডেমো)');
    await expect(page.getByTestId('platform-trail').getByTestId('freshness')).toBeVisible();
  });

  test('offline, the trail cannot be asked for, and says why', async ({ page, context }) => {
    await openPlatform(page);
    await openWorkspace(page, 'SHAPLA');
    await context.setOffline(true);
    await expect(page.getByTestId('platform-offline')).toBeVisible();
    await expect(page.getByTestId('platform-trail-show')).toBeDisabled();
    // What was read stays on the screen.
    await expect(page.getByTestId('platform-health')).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByTestId('platform-trail-show')).toBeEnabled();
  });
});
