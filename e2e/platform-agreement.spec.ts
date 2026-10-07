/**
 * A hospital's agreement state and what it has used, on the platform's screen
 * (`PRD.md` `FR-SUP-04`, the state half; plan G1; `APP_FLOW.md` B7
 * `FRM-B12-AGREEMENT`, `TXT-B12-USAGE`).
 *
 * The platform administrator reads where a hospital's agreement stands,
 * records a new state with a note, and reads three counts of what the
 * hospital has used. Who may do it, what may be written and that it switches
 * nothing are held by `platformAgreement.routes.test.ts`; this is the screen.
 *
 * At Shapla, which the seed leaves active, and Buriganga, which it leaves
 * overdue with a note (`seed_01_hospitals`). What a test sets at Shapla is put
 * back through the platform's own route.
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

/** The platform records Shapla's agreement, as its screen does. */
async function record(state: string, note: string | null): Promise<number> {
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
    body: JSON.stringify({ state, note }),
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

test.afterEach(async () => {
  // As the seed leaves it.
  expect(await record('active', null)).toBe(200);
});

async function openPlatform(page: Page): Promise<void> {
  await page.goto(CONSOLE);
  await expect(page.getByTestId('console-picker')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId('open-platform').click();
  await expect(page.getByTestId('platform-console')).toBeVisible({ timeout: 30_000 });
}

async function openWorkspace(page: Page, code: string): Promise<void> {
  await page.getByTestId(`platform-row-${code}`).click();
  await expect(page.getByTestId('platform-agreement')).toBeVisible();
}

test.describe('a hospital’s agreement on the platform’s screen (FR-SUP-04)', () => {
  test.setTimeout(120_000);

  test('the state is read, changed with a note, and still there after the page is opened again', async ({
    page,
  }) => {
    await openPlatform(page);
    // Active is the ordinary state: nothing about it in the list.
    await expect(
      page.getByTestId('platform-row-SHAPLA').getByTestId('platform-row-agreement'),
    ).toHaveCount(0);

    await openWorkspace(page, 'SHAPLA');
    const choice = (state: string) => page.getByTestId(`platform-agreement-${state}`);
    const save = page.getByTestId('platform-agreement-save');
    await expect(page.getByTestId('platform-agreement')).toHaveAttribute(
      'data-agreement',
      'active',
    );
    await expect(choice('active')).toHaveAttribute('aria-pressed', 'true');
    await expect(choice('overdue')).toHaveAttribute('aria-pressed', 'false');
    // Nothing changed is nothing to save.
    await expect(save).toBeDisabled();

    await choice('overdue').click();
    await expect(choice('overdue')).toHaveAttribute('aria-pressed', 'true');
    await expect(choice('active')).toHaveAttribute('aria-pressed', 'false');
    // A note of one letter is not a note.
    await page.getByTestId('platform-agreement-note').fill('ক');
    await expect(save).toBeDisabled();
    await page.getByTestId('platform-agreement-note').fill('নবায়নের কাগজ আসেনি (ডেমো)');
    await save.click();

    await expect(page.getByTestId('platform-agreement')).toHaveAttribute(
      'data-agreement',
      'overdue',
    );
    await expect(page.getByTestId('platform-agreement-recorded')).toContainText('বকেয়া');
    await expect(save).toBeDisabled();
    // The list says it, because somebody has to act on it.
    await expect(
      page.getByTestId('platform-row-SHAPLA').getByTestId('platform-row-agreement'),
    ).toContainText('চুক্তি বকেয়া');
    // A record and nothing more: the workspace is as live as it was.
    await expect(page.getByTestId('platform-workspace')).toHaveAttribute(
      'data-lifecycle',
      'active',
    );

    await openPlatform(page);
    await openWorkspace(page, 'SHAPLA');
    await expect(choice('overdue')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('platform-agreement-note')).toHaveValue(
      'নবায়নের কাগজ আসেনি (ডেমো)',
    );
  });

  test('what the hospital has used is three counts with their age, and the seed’s overdue clinic is marked in the list', async ({
    page,
  }) => {
    await openPlatform(page);
    await expect(
      page.getByTestId('platform-row-BURIGANGA').getByTestId('platform-row-agreement'),
    ).toContainText('চুক্তি বকেয়া');

    await openWorkspace(page, 'SHAPLA');
    const usage = page.getByTestId('platform-usage');
    await expect(usage).toBeVisible();
    // Three weeks of seeded chambers and serials: neither count is nothing.
    await expect(page.getByTestId('platform-usage-serials')).not.toHaveText('০');
    await expect(page.getByTestId('platform-usage-chambers')).not.toHaveText('০');
    await expect(page.getByTestId('platform-usage-messages')).toHaveText(/^[০-৯,]+$/);
    // A live figure says how old it is.
    await expect(usage.getByTestId('freshness')).toBeVisible();

    await openWorkspace(page, 'BURIGANGA');
    await expect(page.getByTestId('platform-agreement')).toHaveAttribute(
      'data-agreement',
      'overdue',
    );
    await expect(page.getByTestId('platform-agreement-note')).toHaveValue(/\(ডেমো\)/);
  });
});
