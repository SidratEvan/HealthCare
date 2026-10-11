/** Actual React, real local API and synthetic records (Batch 5A, FR-ADM-01..12). */
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { CONSOLE } from '../shared/i18n/src/messages.js';

import { createConsoleSession } from './support/console.js';
import { newFacility } from './support/facility.js';
import { registrationDatabase } from './support/registration.js';
import { DEMO_PASSWORD, staffWithRoles } from './support/staff.js';
import { passSecondFactor } from './support/twoFactor.js';

interface Dashboard {
  readonly range: { readonly from: string; readonly to: string };
  readonly today: { readonly seen: number };
}

const API = 'http://localhost:4000/api/v1';
const directory = resolve('docs/design/console-admin');
const REPORTS = [
  'today',
  'trend',
  'loss',
  'revenue',
  'staff',
  'beds',
  'referrals',
  'feedback',
  'forecast',
] as const;
const madeDesks: string[] = [];
test.afterEach(async () => {
  const ids = madeDesks.splice(0);
  if (ids.length === 0) return;
  await registrationDatabase(async (client) => {
    await client.query('DELETE FROM reception_desk_doctors WHERE desk_id=ANY($1::uuid[])', [ids]);
    await client.query('UPDATE reception_desks SET deleted_at=now() WHERE id=ANY($1::uuid[])', [
      ids,
    ]);
  });
});
test.setTimeout(180_000);

async function shot(page: Page, name: string, fullPage = false) {
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: resolve(directory, `${name}.png`), fullPage });
}
async function axe(page: Page) {
  const source = await readFile(resolve('node_modules/axe-core/axe.min.js'), 'utf8');
  await page.evaluate((code) => {
    const script = document.createElement('script');
    script.nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce ?? '';
    script.textContent = code;
    document.head.appendChild(script);
  }, source);
  const violations = await page.evaluate(async () =>
    (
      await (
        window as unknown as {
          axe: { run: (root: Document) => Promise<{ violations: { id: string }[] }> };
        }
      ).axe.run(document)
    ).violations.map((v) => v.id),
  );
  expect(violations).toEqual([]);
}
async function openAdmin(page: Page, empty = false) {
  const fixture = empty
    ? null
    : await createConsoleSession(3, 'scheduled', { room: 'Admin review (Demo)' });
  const facility = empty ? await newFacility(DEMO_PASSWORD) : null;
  if (facility !== null) {
    await registrationDatabase(async (client) => {
      // A synthetic facility explicitly without these modules; an empty but
      // enabled ER correctly reports a measured zero instead of absence.
      await client.query(
        "INSERT INTO hospital_settings (hospital_id,modules_off) VALUES ($1,'{beds,emergency}') ON CONFLICT (hospital_id) DO UPDATE SET modules_off=EXCLUDED.modules_off",
        [facility.hospitalId],
      );
    });
  }
  const code =
    fixture === null
      ? null
      : await registrationDatabase(
          async (client) =>
            (
              await client.query<{ code: string }>('SELECT code FROM hospitals WHERE id=$1', [
                fixture.hospitalId,
              ])
            ).rows[0]?.code,
        );
  if (fixture !== null && code == null) throw new Error('Missing seeded hospital code');
  const account =
    facility === null
      ? await staffWithRoles(code ?? null, ['hospital_admin'])
      : { email: facility.adminEmail, hospitalId: facility.hospitalId };
  await page.goto('http://localhost:3100/?login=1');
  await page.getByTestId('login-email').fill(account.email);
  await page.getByTestId('login-password').fill(DEMO_PASSWORD);
  await page.getByTestId('login-submit').click();
  await passSecondFactor(page, account.email);
  // The existing single-role picker automatically opens Administration after
  // 2FA. A second click on its transient button races that real navigation.
  await expect(page.getByTestId('admin-dashboard')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('admin-chambers')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('admin-section-today')).toBeVisible({ timeout: 30_000 });
  const token = await page.evaluate(
    () =>
      (JSON.parse(sessionStorage.getItem('console.demo-session') ?? '{}') as { token: string })
        .token,
  );
  return { fixture, token, hospitalId: account.hospitalId };
}
async function reports(page: Page) {
  const response = page.waitForResponse((r) => r.url().includes('/admin/dashboard?') && r.ok());
  await page
    .locator('.cf-nav')
    .getByRole('button', { name: /Reports/ })
    .click();
  const data = (await (await response).json()) as { data: Dashboard };
  await expect(page.getByTestId('admin-section-today')).toBeVisible();
  return data.data;
}

for (const locale of ['bn', 'en'] as const)
  test(`Today, all nine Reports, branding and Help at desktop and tablet sizes in ${locale}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (/hydration|same key/i.test(m.text())) errors.push(m.text());
    });
    const { fixture } = await openAdmin(page);
    if (fixture === null) throw new Error('Missing chamber');
    // Different recorded states, two desks, and counts from real synthetic bookings.
    const chambers = [fixture];
    for (const status of ['running', 'paused', 'ended', 'cancelled'] as const) {
      const next = await createConsoleSession(3, 'in-chamber', {
        hospitalId: fixture.hospitalId,
        room: `Admin ${status} (Demo)`,
      });
      await registrationDatabase(async (client) => {
        await client.query('UPDATE sessions SET status=$2::session_status WHERE id=$1', [
          next.sessionId,
          status,
        ]);
      });
      chambers.push(next);
    }
    await registrationDatabase(async (client) => {
      const desks = await client.query<{ id: string }>(
        "INSERT INTO reception_desks (hospital_id,name_bn,name_en) VALUES ($1,'প্রধান ডেস্ক (ডেমো) ' || $2,'Main desk (Demo) ' || $2),($1,'দ্বিতীয় ডেস্ক (ডেমো) ' || $2,'Second desk (Demo) ' || $2) RETURNING id",
        [fixture.hospitalId, locale],
      );
      madeDesks.push(...desks.rows.map((desk) => desk.id));
      for (const desk of desks.rows)
        await client.query(
          'INSERT INTO reception_desk_doctors (desk_id,doctor_id,hospital_id) VALUES ($1,$2,$3)',
          [desk.id, fixture.doctorId, fixture.hospitalId],
        );
    });
    await page.getByTestId('language-' + locale).click();
    await page.getByTestId('admin-now-refresh').click();
    for (const chamber of chambers)
      await expect(
        page
          .locator(`[data-testid="admin-chamber-row"][data-session-id="${chamber.sessionId}"]`)
          .first(),
      ).toBeVisible();
    for (const chamber of chambers) {
      const row = page
        .locator(`[data-testid="admin-chamber-row"][data-session-id="${chamber.sessionId}"]`)
        .first();
      await expect(row.locator('td').nth(3)).toHaveText(
        locale === 'bn'
          ? chamber.sessionId === fixture.sessionId
            ? '৩'
            : '২'
          : chamber.sessionId === fixture.sessionId
            ? '3'
            : '2',
      );
      await expect(row.locator('td').nth(4)).toHaveText(locale === 'bn' ? '০' : '0');
      await expect(row.locator('td').nth(5)).toHaveText(locale === 'bn' ? '০' : '0');
    }
    for (const key of [
      'adminChamberScheduled',
      'adminChamberRunning',
      'adminChamberPaused',
      'adminChamberEnded',
      'adminChamberCancelled',
    ] as const)
      await expect(
        page.getByTestId('admin-chambers').getByText(CONSOLE[key][locale], { exact: true }).first(),
      ).toBeVisible();
    expect(await page.getByTestId('admin-desk-group').count()).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId('admin-attention')).toContainText(
      CONSOLE.adminAttentionOverdue[locale],
    );
    await expect(page.getByTestId('admin-attention')).toContainText(
      CONSOLE.adminAttentionPaused[locale],
    );
    for (const [width, height, name] of [
      [1440, 900, 'desktop'],
      [1024, 768, 'landscape'],
      [768, 1024, 'portrait'],
    ] as const) {
      await page.setViewportSize({ width, height });
      await shot(page, `today-${name}-${locale}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await shot(page, `today-full-${locale}`, true);
    await axe(page);
    await page.getByRole('button', { name: /Help/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await shot(page, `today-help-${locale}`);
    await page.keyboard.press('Escape');
    await reports(page);
    for (const report of REPORTS) {
      await page.getByTestId('admin-tab-' + report).click();
      await expect(page.getByTestId('admin-section-' + report)).toBeVisible();
      await expect(
        page.getByTestId('admin-section-' + report).getByTestId('freshness'),
      ).toBeVisible();
      await shot(page, `reports-${report}-${locale}`, true);
    }
    await page.getByTestId('admin-tab-today').click();
    for (const [width, height, name] of [
      [1024, 768, 'landscape'],
      [768, 1024, 'portrait'],
    ] as const) {
      await page.setViewportSize({ width, height });
      await shot(page, `reports-${name}-${locale}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      for (const report of REPORTS) {
        await page.getByTestId('admin-tab-' + report).click();
        await expect(page.getByTestId('admin-section-' + report)).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
      await page.getByTestId('admin-tab-today').click();
    }
    await axe(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: /Help/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await shot(page, `reports-help-${locale}`);
    await page.keyboard.press('Escape');
    await page.getByTestId('admin-tab-today').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('admin-tab-trend')).toBeFocused();
    await expect(page.getByTestId('admin-tab-trend')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('admin-tab-today')).toBeFocused();
    // Browser scaling exercises text/control wrapping, alongside tablet widths.
    await page.evaluate(() => {
      const workspace = document.querySelector<HTMLElement>('.admin-workspace');
      if (workspace !== null) workspace.style.zoom = '2';
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await shot(page, `reports-scale-200-${locale}`);
    await page.evaluate(() => {
      const workspace = document.querySelector<HTMLElement>('.admin-workspace');
      if (workspace !== null) workspace.style.zoom = '';
    });
    expect(errors).toEqual([]);
  });

test('all nine reports, twelve CSVs with V1 column order and print agree with the displayed period', async ({
  page,
}) => {
  const { token } = await openAdmin(page);
  await page.getByTestId('language-en').click();
  const data = await reports(page);
  const headers: Record<string, string> = {
    today: 'metric,value',
    trend: 'date,avg_wait_minutes,waits_measured,avg_overrun_minutes,overruns_measured,seen',
    loss: 'date,uncollected_poisha,recovered_poisha',
    staff:
      'doctor,department,sessions,never_started,on_time,median_delta_minutes,worst_delta_minutes,avg_consult_seconds,seen',
    beds: 'kind,total,occupied,admissions,alos_hours,turnover_hours',
    referrals: 'metric,value',
    feedback: 'category,average,answered,complaints',
    forecast: 'weekday,slot,expected,low,high,observations',
  };
  for (const report of REPORTS) {
    await page.getByTestId('admin-tab-' + report).click();
    for (const view of report === 'revenue'
      ? ['revenue-doctor', 'revenue-department', 'revenue-method', 'revenue-service']
      : [report]) {
      if (report === 'revenue') await page.getByTestId('admin-export-breakdown').selectOption(view);
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('admin-export').click(),
      ]);
      expect(download.suggestedFilename()).toBe(
        `${view}-${data.range.from}-to-${data.range.to}.csv`,
      );
      const path = await download.path();
      if (path === null) throw new Error('Missing CSV');
      const csv = await readFile(path);
      expect(
        csv
          .toString('utf8')
          .replace(/^\uFEFF/, '')
          .split('\r\n')[0],
      ).toBe(
        report === 'revenue'
          ? 'label,label_en,bookings,billed_poisha,collected_poisha,refunded_poisha'
          : headers[report],
      );
      const backend = await page.request.get(
        `${API}/admin/export?view=${view}&from=${data.range.from}&to=${data.range.to}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(backend.ok()).toBe(true);
      expect(csv.equals(await backend.body())).toBe(true);
      if (view === 'today') expect(csv.toString('utf8')).toContain(`seen,${data.today.seen}\r\n`);
    }
    await page.evaluate(() => {
      globalThis.print = () => document.documentElement.setAttribute('data-print-called', 'yes');
    });
    await page.getByTestId('admin-print').click();
    await expect(page.locator('html')).toHaveAttribute('data-print-called', 'yes');
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.cf-nav')).toBeHidden();
    await expect(page.getByTestId('admin-loaded-range')).toContainText(data.range.from);
    await expect(page.getByTestId('admin-section-' + report)).toBeVisible();
    for (const other of REPORTS)
      if (other !== report) await expect(page.getByTestId('admin-section-' + other)).toHaveCount(0);
    await shot(page, `print-${report}-en`, true);
    await page.pdf({
      path: resolve(directory, `print-${report}-en.pdf`),
      format: 'A4',
      printBackground: true,
    });
    await page.emulateMedia({ media: 'screen' });
  }
});

test('four Bangladesh periods, latest-request wins, errors and offline retain the truthful range', async ({
  page,
  context,
}) => {
  await openAdmin(page);
  await page.getByTestId('language-en').click();
  await reports(page);
  for (const [label, days] of [
    ['Today', 0],
    ['Last 7 days', 6],
    ['Last 30 days', 29],
    ['Last 90 days', 89],
  ] as const) {
    const answer = page.waitForResponse((r) => r.url().includes('/admin/dashboard?') && r.ok());
    await page.getByRole('button', { name: label, exact: true }).click();
    const data = (await (await answer).json()) as { data: Dashboard };
    expect((Date.parse(data.data.range.to) - Date.parse(data.data.range.from)) / 86_400_000).toBe(
      days,
    );
    await expect(page.getByTestId('admin-loaded-range')).toContainText(data.data.range.from);
  }
  let releaseOld: () => void = () => undefined;
  const oldHeld = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  let observedOld: () => void = () => undefined;
  const oldStarted = new Promise<void>((resolve) => {
    observedOld = resolve;
  });
  let first = true;
  await page.route('**/admin/dashboard?*', async (route) => {
    if (first) {
      first = false;
      const answer = await route.fetch();
      observedOld();
      await oldHeld;
      await route.fulfill({ response: answer });
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Last 7 days', exact: true }).click();
  await oldStarted;
  await expect(page.getByTestId('admin-export')).toBeDisabled();
  const recentAnswer = page.waitForResponse((r) => r.url().includes('/admin/dashboard?') && r.ok());
  await page.getByRole('button', { name: 'Last 30 days', exact: true }).click();
  const recent = (await (await recentAnswer).json()) as { data: Dashboard };
  await expect(page.getByTestId('admin-loaded-range')).toContainText(recent.data.range.from);
  const oldAnswer = page.waitForResponse((r) => r.url().includes('/admin/dashboard?') && r.ok());
  releaseOld();
  await oldAnswer;
  // A subsequent render must still carry the newest result.
  await page.getByTestId('admin-tab-loss').click();
  await expect(page.getByTestId('admin-loaded-range')).toContainText(recent.data.range.from);
  await page.getByTestId('admin-tab-today').click();
  await page.unroute('**/admin/dashboard?*');
  await page.route('**/admin/dashboard?*', async (route) => {
    if (route.request().url().includes('from=')) {
      await route.fulfill({
        status: 503,
        json: { error: { code: 'UNAVAILABLE', message: 'Synthetic outage' } },
      });
    }
  });
  const retained = await page.getByTestId('admin-loaded-range').innerText();
  const seen = await page.getByTestId('admin-seen-value').innerText();
  await page.getByRole('button', { name: 'Last 7 days', exact: true }).click();
  await expect(page.getByTestId('admin-reports').getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('admin-loaded-range')).toHaveText(retained);
  // A failed read still exports the explicitly displayed dates.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('admin-export').click(),
  ]);
  expect(download.suggestedFilename()).toContain(
    /\d{4}-\d{2}-\d{2}/.exec(retained)?.[0] ?? 'missing',
  );
  await shot(page, 'reports-retained-error-en');
  await page.unroute('**/admin/dashboard?*');
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Last 30 days', exact: true }).click();
  await expect(page.getByTestId('admin-offline-banner')).toBeVisible();
  await expect(page.getByTestId('admin-seen-value')).toHaveText(seen);
  await expect(page.getByTestId('admin-loaded-range')).toHaveText(retained);
  await expect(page.getByTestId('admin-export')).toBeDisabled();
  await shot(page, 'reports-offline-en');
  await context.setOffline(false);
  await page.getByTestId('admin-retry').click();
  await expect(page.getByTestId('admin-offline-banner')).toHaveCount(0);
});

test('empty hospital distinguishes recorded zeros from unavailable service, loading, errors and stale snapshots', async ({
  page,
}) => {
  const { token } = await openAdmin(page, true);
  await page.getByTestId('language-en').click();
  await expect(page.getByTestId('admin-chambers-empty')).toBeVisible();
  await expect(page.getByTestId('admin-now-waiting')).toContainText('0');
  await expect(page.getByTestId('admin-now-beds')).toContainText('Bed count unavailable');
  await expect(page.getByTestId('admin-now-emergency')).toContainText('No emergency desk here');
  await shot(page, 'today-empty-en');
  const response = await page.request.get(`${API}/admin/overview`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await response.json()) as { data: Record<string, unknown> };
  const stale = { data: { ...body.data, serverTs: new Date(Date.now() - 600_000).toISOString() } };
  await page.route('**/admin/overview', (route) => route.fulfill({ json: stale }));
  await page.getByTestId('admin-now-refresh').click();
  await expect(page.getByTestId('admin-snapshot-old')).toBeVisible();
  await shot(page, 'today-stale-en');
  await page.unroute('**/admin/overview');
  await page.route('**/admin/overview', (route) =>
    route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE' } } }),
  );
  await page.getByTestId('admin-now-refresh').click();
  await expect(page.getByTestId('admin-now-failed')).toBeVisible();
  await expect(page.getByTestId('admin-now-waiting')).toContainText('0');
  await shot(page, 'today-error-en');
  await page.unroute('**/admin/overview');
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/admin/dashboard?*', async (route) => {
    await held;
    await route.continue();
  });
  await page
    .locator('.cf-nav')
    .getByRole('button', { name: /Reports/ })
    .click();
  await expect(page.getByTestId('admin-loading')).toBeVisible();
  await shot(page, 'reports-loading-en');
  release();
  await expect(page.getByTestId('admin-section-today')).toBeVisible();
});

test('Staff & Desks, Doctors and Settings open their working V1 panes', async ({ page }) => {
  await openAdmin(page);
  for (const [label, tab] of [
    ['Staff & Desks', 'staff'],
    ['Doctors', 'doctors'],
    ['Settings', 'profile'],
  ] as const) {
    await page
      .locator('.cf-nav')
      .getByRole('button', { name: new RegExp(label.replace('&', '&')) })
      .click();
    await expect(page.getByTestId('hospital-settings')).toBeVisible();
    await expect(page.getByTestId('settings-tab-' + tab)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#settings-panel-' + tab)).toBeVisible();
    await page.getByTestId('settings-back').click();
    await expect(page.getByTestId('admin-dashboard')).toBeVisible();
  }
});
