/** Resumed Platform/Import/National safety, Help and responsive workspace gate. */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { adminToken } from './support/console.js';
import { newFacility, removeFacility } from './support/facility.js';

const CONSOLE = 'http://localhost:3100';
const directory = resolve('docs/design/console-reporting');

async function axe(page: Page): Promise<void> {
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
    ).violations.map((item) => item.id),
  );
  expect(violations).toEqual([]);
}

async function shot(page: Page, name: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(directory, `${name}.png`), fullPage: true });
}

async function picker(page: Page, role: 'platform' | 'gov'): Promise<void> {
  await page.goto(CONSOLE);
  await expect(page.getByTestId('console-picker')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId(`open-${role}`).click();
}

test('Platform keeps unsaved creation through Help and cancelled navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await picker(page, 'platform');
  await expect(page.getByTestId('platform-list')).toBeVisible();
  await page.getByTestId('platform-new').click();
  const name = page.getByTestId('platform-new-form').getByLabel('হাসপাতালের নাম (বাংলা)');
  await name.fill('Demo unfinished workspace');
  await page.locator('.cf-help-button').click();
  await expect(page.locator('[data-help-topic="platform-onboarding"]')).toBeVisible();
  await axe(page);
  await page.getByRole('dialog').getByRole('button', { name: 'বন্ধ করুন' }).click();
  await expect(name).toHaveValue('Demo unfinished workspace');
  await page.getByTestId('platform-row-PADMA').click();
  await expect(page.getByTestId('management-confirm')).toBeVisible();
  await page.getByTestId('management-confirm-cancel').click();
  await expect(name).toHaveValue('Demo unfinished workspace');
  await axe(page);
  await shot(page, 'platform-tablet-draft');
});

test('National filters preserve national totals; hour cells work by keyboard and Help preserves selection', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await picker(page, 'gov');
  await expect(page.getByTestId('gov-beds-free-value')).toBeVisible();
  const total = await page.getByTestId('gov-beds-free-value').innerText();
  await page.getByTestId('gov-district-filter').selectOption('Dhaka');
  await expect(page.getByTestId('gov-district-Chattogram')).toHaveCount(0);
  await expect(page.getByTestId('gov-district-Dhaka')).toBeVisible();
  await expect(page.getByTestId('gov-beds-free-value')).toHaveText(total);
  await page.getByTestId('gov-tab-capacity').focus();
  await page.keyboard.press('ArrowRight');
  const cell = page.getByTestId('gov-heat-Dhaka').getByRole('button').first();
  await cell.focus();
  await page.keyboard.press('Enter');
  await expect(cell).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('gov-hour-detail')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await axe(page);
  await shot(page, 'national-tablet-hour');
  await page.locator('.cf-help-button').click();
  await expect(page.locator('[data-help-topic="national"]')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'বন্ধ করুন' }).click();
  await expect(cell).toHaveAttribute('aria-pressed', 'true');
});

test('National retains figures with an explicit failed-refresh warning', async ({ page }) => {
  await page.clock.install();
  await picker(page, 'gov');
  await expect(page.getByTestId('gov-beds-free-value')).toBeVisible();
  const total = await page.getByTestId('gov-beds-free-value').innerText();
  await page.route('**/api/v1/gov/**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'INTERNAL' } }),
    }),
  );
  await page.clock.runFor(61_000);
  await expect(page.getByTestId('gov-refresh-failed')).toBeVisible();
  await expect(page.getByTestId('gov-beds-free-value')).toHaveText(total);
});

test('Import retains its file through Help and reconciles a committed write whose reply was lost', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const facility = await newFacility('accelerated-demo-password');
  try {
    const token = await adminToken(facility.hospitalId);
    await page.addInitScript(
      ({ access, hospitalId }) =>
        sessionStorage.setItem(
          'console.demo-session',
          JSON.stringify({
            token: access,
            hospitalId,
            role: 'hospital_admin',
            staffName: 'Demo Administrator',
          }),
        ),
      { access: token, hospitalId: facility.hospitalId },
    );
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`${CONSOLE}/?view=imports`);
    await expect(page.getByTestId('hospital-import')).toBeVisible();
    const ref = `D${randomUUID().slice(0, 6).toUpperCase()}`;
    const headings =
      'type,ref,name_bn,name_en,code,bmdc_number,degrees,specialties,department_ref,room,fee_taka,doctor_ref,weekday,start,end,serials,ward_ref,floor,bed_kind,bed_label,nightly_taka,role,email';
    const values: Record<string, string> = {
      type: 'department',
      ref,
      name_bn: 'Demo',
      name_en: 'Demo',
      code: ref,
    };
    const csv =
      headings +
      '\n' +
      headings
        .split(',')
        .map((key) => values[key] ?? '')
        .join(',');
    await page.getByTestId('import-file').setInputFiles({
      name: 'demo-department.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });
    await page.locator('.cf-help-button').click();
    await expect(page.locator('[data-help-topic="import"]')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'বন্ধ করুন' }).click();
    expect(
      await page
        .getByTestId('import-file')
        .evaluate((input) => (input as HTMLInputElement).files?.[0]?.name),
    ).toBe('demo-department.csv');
    await page.getByTestId('import-check').click();
    await expect(page.getByTestId('import-preview')).toBeVisible();
    await axe(page);
    await shot(page, 'import-tablet-preview');
    let commits = 0;
    await page.route('**/api/v1/hospital/imports/*/commit', async (route) => {
      commits += 1;
      const result = await route.fetch();
      expect(result.status()).toBe(200);
      await route.abort('failed');
    });
    await page.getByTestId('import-commit').click();
    await page.getByTestId('import-confirm-yes').click();
    await expect(page.getByTestId('import-uncertain')).toBeVisible();
    expect(commits).toBe(1);
    await page.getByTestId('import-reconcile').click();
    await expect(page.getByTestId('import-uncertain')).toHaveCount(0);
    await expect(page.getByTestId('import-preview')).toContainText('সংরক্ষিত');
    expect(commits).toBe(1);
  } finally {
    await removeFacility(facility.hospitalId);
  }
});
