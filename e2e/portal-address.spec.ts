/**
 * A hospital's portal has an address (`PRD.md` `FR-BRD-07`, `FR-BRD-04`;
 * plan C2).
 *
 * The patient app opened at `<code>.<platform domain>`, or at a domain the
 * hospital owns and the platform has recorded, is that hospital's portal with
 * nothing in the address to say so, and nothing in the address takes it out.
 *
 * On this machine the platform's domain is `localhost` (`playwright.config.ts`),
 * so `padma.localhost` is Padma's portal; a browser resolves any name under
 * `localhost` to this machine. A hospital's own domain is a name the browser
 * is told is this machine (`--host-resolver-rules`), which is all that
 * pointing a domain's DNS at the platform comes to.
 */

import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';

import { signToken } from '../backend/api/src/config/jwt.js';

import { E2E_DATABASE_URL, assertLocalDatabase } from './support/database.js';

const API = 'http://localhost:4000/api/v1';
const NETWORK = 'http://localhost:3000';
const PADMA_PORTAL = 'http://padma.localhost:3000';
const PADMA_BRAND = '#17507f';
/** The network's own primary in the patient app: Visual Direction 2's logo blue (FRONTEND.md §0.5, `PATIENT_COLOUR`). */
const PLATFORM_BRAND = '#0066dd';

/** A domain Karnaphuli "owns", for this spec. */
const OWN_DOMAIN = 'portal.hospital-own.test';
const OWN_PORTAL = `http://${OWN_DOMAIN}:3000`;

// The browser is told the hospital's own name is this machine: what DNS does
// on a server. For the whole file, since a browser is launched once.
test.use({
  launchOptions: { args: [`--host-resolver-rules=MAP ${OWN_DOMAIN} 127.0.0.1`] },
});

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

async function brand600(page: Page): Promise<string> {
  return await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--brand-600').trim(),
  );
}

/** The platform administrator records, or removes, a hospital's own domain. */
async function recordDomain(hospitalId: string, domain: string | null): Promise<number> {
  const adminId = await withClient(async (client) => {
    const result = await client.query<{ staff_user_id: string }>(
      `SELECT staff_user_id FROM staff_roles
        WHERE role = 'platform_admin' AND hospital_id IS NULL AND deleted_at IS NULL
        LIMIT 1`,
    );
    const id = result.rows[0]?.staff_user_id;
    if (id === undefined) throw new Error('The seed should hold a platform administrator.');
    return id;
  });
  const token = await signToken({
    kind: 'access',
    claims: { sub: adminId, kind: 'staff', roles: ['platform_admin'] },
  });
  const response = await fetch(`${API}/platform/hospitals/${hospitalId}/domain`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
    },
    body: JSON.stringify({ domain }),
  });
  return response.status;
}

test.describe('under the platform’s domain, a hospital’s code is its portal', () => {
  test('it is that hospital’s with no parameter: its name, its colours, its hospital only', async ({
    page,
  }) => {
    await page.goto(PADMA_PORTAL);
    await expect(page.getByTestId('app-name')).toContainText('পদ্মা');
    await expect(page.locator('html')).toHaveAttribute('data-scope', 'PADMA');
    await expect.poll(async () => await brand600(page)).toBe(PADMA_BRAND);
    // Never a wait to find out whose it is: the address says.
    await expect(page.getByTestId('portal-gate')).toHaveCount(0);

    await page.getByTestId('home-search').click();
    await page.getByTestId('need-bed:icu').click();
    const hospitals = page
      .getByTestId('search-results')
      .locator('[data-testid^="result-hospital-"]');
    await expect(hospitals).toHaveCount(1);
    await expect(hospitals.first()).toContainText('পদ্মা');
  });

  test('nothing in the address makes it another hospital’s, or takes it out', async ({ page }) => {
    await page.goto(`${PADMA_PORTAL}/?scope=SHAPLA`);
    await expect(page.locator('html')).toHaveAttribute('data-scope', 'PADMA');
    await expect(page.getByTestId('app-name')).toContainText('পদ্মা');

    await page.goto(`${PADMA_PORTAL}/search?scope=`);
    await expect(page.getByTestId('search-intro')).toContainText('পদ্মা');
    const hospitals = page
      .getByTestId('search-results')
      .locator('[data-testid^="result-hospital-"]');
    await expect(hospitals).toHaveCount(1);
  });

  test('the network’s own address is still the network', async ({ page }) => {
    await page.goto(NETWORK);
    await expect(page.getByTestId('app-name')).toHaveText('MedLiveBD');
    await expect(page.locator('html')).not.toHaveAttribute('data-scope', /.+/);
    expect(await brand600(page)).toBe(PLATFORM_BRAND);
  });

  test('a booking made in the portal is followed in the portal', async ({ page }) => {
    const padma = await (await fetch(`${API}/config?scope=PADMA`)).json();
    const hospitalId = (padma as { data: { scope: { hospitalId: string } } }).data.scope.hospitalId;

    // The link a guest is sent is built for the address the booking came from.
    const sessions = await (await fetch(`${API}/sessions?hospitalId=${hospitalId}`)).json();
    const sessionId = (sessions as { data: { sessions: { id: string; serialsLeft?: number }[] } })
      .data.sessions[0]?.id;
    expect(sessionId).toBeTruthy();

    await page.goto(PADMA_PORTAL);
    const booked = await page.evaluate(
      async ({ api, session, phone }) => {
        const response = await fetch(`${api}/bookings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
          body: JSON.stringify({
            sessionId: session,
            method: 'at_hospital',
            guest: { name: 'রহিমা খাতুন (ডেমো)', phone, ageYears: 34, sex: 'female' },
          }),
        });
        return {
          status: response.status,
          body: (await response.json()) as { data?: { trackingUrl?: string | null } },
        };
      },
      {
        api: API,
        session: sessionId ?? '',
        phone: `+88019${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`,
      },
    );
    // Sent from the portal's own page, so the browser's CORS check is part of
    // this: the API answers a hospital's portal.
    expect(booked.status).toBe(201);
    const link = new URL(booked.body.data?.trackingUrl ?? '');
    expect(link.origin).toBe(PADMA_PORTAL);

    // And it opens there, as Padma's.
    await page.goto(link.toString());
    await expect(page.locator('html')).toHaveAttribute('data-scope', 'PADMA');
    await expect(page.getByTestId('live-serial')).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('a domain the hospital owns, recorded by the platform', () => {
  let karnaphuli: string;

  test.beforeAll(async () => {
    karnaphuli = await withClient(async (client) => {
      const result = await client.query<{ id: string }>(
        `SELECT id FROM hospitals WHERE code = 'KARNAPHULI'`,
      );
      const id = result.rows[0]?.id;
      if (id === undefined) throw new Error('The seed should hold KARNAPHULI (FR-DEM-01).');
      return id;
    });
  });

  test.afterAll(async () => {
    await recordDomain(karnaphuli, null);
  });

  test('before it is recorded the name is nobody’s; after, it is that hospital’s portal', async ({
    page,
  }) => {
    expect(await recordDomain(karnaphuli, null)).toBe(200);

    // A name the app cannot read by itself: it asks, and is told nobody's.
    // It shows nothing of anybody's, says so, and points at the network.
    await page.goto(OWN_PORTAL);
    const gate = page.getByTestId('portal-gate');
    await expect(gate).toHaveAttribute('data-state', 'nobodys');
    await expect(page.locator('[data-testid^="home-need-"]')).toHaveCount(0);
    await expect(page.getByTestId('portal-go-network')).toHaveAttribute('href', NETWORK);

    expect(await recordDomain(karnaphuli, OWN_DOMAIN)).toBe(200);

    // A new visit: the answer is kept for a visit, and this is another.
    await page.evaluate(() => {
      sessionStorage.clear();
    });
    await page.goto(OWN_PORTAL);
    await expect(page.locator('html')).toHaveAttribute('data-scope', 'KARNAPHULI');
    await expect(page.getByTestId('app-name')).toContainText('কর্ণফুলী');

    // Its hospital only, with nothing in the address.
    await page.goto(`${OWN_PORTAL}/search`);
    const hospitals = page
      .getByTestId('search-results')
      .locator('[data-testid^="result-hospital-"]');
    await expect(hospitals).toHaveCount(1);
    await expect(hospitals.first()).toContainText('কর্ণফুলী');

    // And `?scope=` there does not make it another's.
    await page.goto(`${OWN_PORTAL}/?scope=PADMA`);
    await expect(page.locator('html')).toHaveAttribute('data-scope', 'KARNAPHULI');
  });

  test('while the server cannot be asked, nothing of anybody’s is shown, and it says so', async ({
    page,
    context,
  }) => {
    expect(await recordDomain(karnaphuli, OWN_DOMAIN)).toBe(200);
    // The API cannot be reached; the page itself can.
    await context.route(`${API}/**`, async (route) => {
      await route.abort('internetdisconnected');
    });
    await page.goto(OWN_PORTAL);
    const gate = page.getByTestId('portal-gate');
    await expect(gate).toHaveAttribute('data-state', 'unreachable');
    await expect(page.locator('[data-testid^="home-need-"]')).toHaveCount(0);

    await context.unroute(`${API}/**`);
    await gate.getByRole('button').click();
    await expect(page.locator('html')).toHaveAttribute('data-scope', 'KARNAPHULI');
    await expect(page.getByTestId('portal-gate')).toHaveCount(0);
  });
});

test('the platform administrator records a hospital’s own domain from its workspace (S-B-12)', async ({
  page,
}) => {
  const CONSOLE = 'http://localhost:3100';
  const id = await withClient(async (client) => {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM hospitals WHERE code = 'MEGHNA'`,
    );
    return result.rows[0]?.id ?? '';
  });

  try {
    await page.goto(CONSOLE);
    await expect(page.getByTestId('console-picker')).toBeVisible({ timeout: 45_000 });
    await page.getByTestId('open-platform').click();
    await expect(page.getByTestId('platform-console')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('platform-row-MEGHNA').click();

    const portal = page.getByTestId('platform-portal');
    await expect(portal).toBeVisible();
    // Under the platform's domain its address needs nothing done.
    await expect(page.getByTestId('platform-portal-address')).toHaveText(
      'http://meghna.localhost:3000',
    );

    // A name under the platform's own domain is not a hospital's to own.
    await page.getByTestId('platform-domain-input').fill('anything.localhost');
    await page.getByTestId('platform-domain-save').click();
    await expect(page.getByTestId('platform-problem')).toBeVisible();

    await page.getByTestId('platform-domain-input').fill('Portal.Meghna-Diagnostic.Test');
    await page.getByTestId('platform-domain-save').click();
    await expect(page.getByTestId('platform-domain-remove')).toBeVisible();
    await expect(page.getByTestId('platform-domain-input')).toHaveValue(
      'portal.meghna-diagnostic.test',
    );
    // What is recorded is what is recorded: the same again is nothing to save.
    await expect(page.getByTestId('platform-domain-save')).toBeDisabled();

    const answered = await fetch(`${API}/config?host=portal.meghna-diagnostic.test`);
    const scope = ((await answered.json()) as { data: { scope: { code: string } | null } }).data
      .scope;
    expect(scope?.code).toBe('MEGHNA');

    await page.getByTestId('platform-domain-remove').click();
    await expect(page.getByTestId('platform-domain-remove')).toHaveCount(0);
  } finally {
    await recordDomain(id, null);
  }
});
