/** Batch 5B: actual React, hospital-owned API, synthetic records and reviewed writes. */
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { CONSOLE } from '../shared/i18n/src/messages.js';

import { newFacility } from './support/facility.js';
import { staffWithRoles, DEMO_PASSWORD } from './support/staff.js';
import { passSecondFactor } from './support/twoFactor.js';

const API = 'http://localhost:4000/api/v1';
const directory = resolve('docs/design/console-admin-management');
test.setTimeout(180_000);
type Key = keyof typeof CONSOLE;
async function nav(page: Page, key: Key, locale: 'bn' | 'en' = 'en') {
  await page.locator('.cf-nav').getByRole('button', { name: CONSOLE[key][locale] }).click();
  await expect(page.getByTestId('hospital-settings')).toBeVisible();
}
async function review(page: Page) {
  await expect(page.getByTestId('management-confirm')).toBeVisible();
  await page.getByTestId('management-confirm-save').click();
  await expect(page.getByTestId('management-confirm')).not.toBeVisible();
}
async function shot(page: Page, name: string) {
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(directory, `${name}.png`), fullPage: true });
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
async function setup(page: Page) {
  page.setDefaultTimeout(10_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const facility = await newFacility(DEMO_PASSWORD);
  const receptionist = await staffWithRoles(facility.code, ['receptionist']);
  await page.goto('http://localhost:3100/?login=1');
  await page.getByTestId('login-email').fill(facility.adminEmail);
  await page.getByTestId('login-password').fill(DEMO_PASSWORD);
  await page.getByTestId('login-submit').click();
  await passSecondFactor(page, facility.adminEmail);
  await expect(page.getByTestId('admin-dashboard')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('language-en').click();
  const token = await page.evaluate(
    () =>
      (JSON.parse(sessionStorage.getItem('console.demo-session') ?? '{}') as { token: string })
        .token,
  );
  let sequence = 0;
  async function api(path: string, data?: unknown) {
    const response = await page.request.post(`${API}/hospital/${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': `management-${facility.code}-${++sequence}`,
      },
      data,
    });
    expect(response.ok()).toBe(true);
    return (await response.json()) as { data: Record<string, string> };
  }
  const dept = await api('departments', {
    nameBn: 'মেডিসিন (ডেমো)',
    nameEn: 'Medicine (Demo)',
    code: 'MED',
  });
  const doctor = await api('doctors', {
    nameBn: 'ডা. পরিচালনা (ডেমো)',
    nameEn: 'Dr Management (Demo)',
    bmdcNumber: `Z-${String(Date.now()).slice(-7)}`,
    departmentId: dept.data['departmentId'],
    feePoisha: 50000,
    room: '101',
    degrees: 'MBBS',
    defaultConsultMinutes: 15,
  });
  const deskIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    const result = await api('desks', {
      nameBn: `ডেস্ক ${i + 1} (ডেমো)`,
      nameEn: `Desk ${i + 1} (Demo)`,
      doctorIds: [],
      staffIds: i === 0 ? [receptionist.id] : [],
    });
    deskIds.push(result.data['deskId']!);
  }
  return { facility, receptionist, doctorId: doctor.data['doctorHospitalId']!, deskIds, token };
}

for (const locale of ['bn', 'en'] as const)
  test(`integrated lists, person panels, all settings groups, Help, tablet and accessibility in ${locale}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const fixture = await setup(page);
    if (locale === 'bn') await page.getByRole('button', { name: 'বাংলা', exact: true }).click();
    await nav(page, 'adminNavStaff', locale);
    await expect(page.getByTestId(`management-person-${fixture.receptionist.id}`)).toContainText(
      'Access review',
    );
    await shot(page, `staff-desktop-${locale}`);
    await axe(page);
    await page.getByTestId('management-search').fill('No matching synthetic staff');
    await expect(page.locator('.admin-empty')).toHaveText(CONSOLE.manageNoMatches[locale]);
    await shot(page, `staff-no-matches-${locale}`);
    await page.getByTestId('management-search').fill('');
    await page.getByTestId(`management-change-${fixture.receptionist.id}`).click();
    await expect(page.getByTestId('staff-desk-assignments')).toBeVisible();
    await expect(page.getByTestId(`staff-assignment-${fixture.deskIds[0]}`)).toBeChecked();
    await shot(page, `staff-person-${locale}`);
    await axe(page);
    await page.getByTestId(`staff-assignment-${fixture.deskIds[1]}`).check();
    await page.getByTestId('staff-assignments-save').click();
    await expect(page.getByTestId('management-confirm')).toContainText(
      locale === 'bn' ? 'ডেস্ক 2' : 'Desk 2',
    );
    await shot(page, `staff-desk-review-${locale}`);
    await review(page);
    await expect(page.getByTestId('staff-assignment-results')).toContainText(
      CONSOLE.manageConfirmed[locale],
    );
    await expect(page.getByTestId('management-unsaved')).not.toBeVisible();
    await page.getByTestId('management-close').click();
    await expect(page.getByTestId(`management-change-${fixture.receptionist.id}`)).toBeFocused();
    await page.getByTestId('management-group-desks').click();
    await shot(page, `desks-${locale}`);
    await page.getByTestId(`desk-change-${fixture.deskIds[0]}`).click();
    await shot(page, `desk-editor-${locale}`);
    await page.getByTestId('desk-close').click();
    await expect(page.getByTestId(`desk-change-${fixture.deskIds[0]}`)).toBeFocused();
    await page.getByTestId('management-group-access').click();
    await shot(page, `access-${locale}`);
    await nav(page, 'adminNavDoctors', locale);
    await shot(page, `doctors-desktop-${locale}`);
    await axe(page);
    await page.getByTestId('management-search').fill('No matching synthetic doctor');
    await expect(page.locator('.admin-empty')).toHaveText(CONSOLE.manageNoMatches[locale]);
    await shot(page, `doctors-no-matches-${locale}`);
    await page.getByTestId('management-search').fill('');
    await page.getByTestId(`management-change-${fixture.doctorId}`).click();
    await expect(page.getByTestId(`settings-doctor-fee-${fixture.doctorId}`)).toBeVisible();
    await shot(page, `doctor-person-${locale}`);
    await axe(page);
    await expect(page.getByTestId('management-unsaved')).not.toBeVisible();
    await page.getByTestId('management-close').click();
    await expect(page.getByTestId(`management-change-${fixture.doctorId}`)).toBeFocused();
    await page.getByTestId('management-group-departments').click();
    await shot(page, `departments-${locale}`);
    await nav(page, 'adminNavSettings', locale);
    await shot(page, `settings-home-${locale}`);
    await axe(page);
    for (const group of ['profile', 'face', 'rules', 'beds', 'capabilities', 'identity', 'sms']) {
      await page.getByTestId(`settings-group-${group}`).click();
      await shot(page, `settings-${group}-${locale}`);
      await axe(page);
      await page.getByTestId('settings-back').click();
    }
    for (const [width, height, name] of [
      [1024, 768, 'landscape'],
      [768, 1024, 'portrait'],
    ] as const) {
      await page.setViewportSize({ width, height });
      for (const section of ['staff', 'doctors', 'settings'] as const) {
        await nav(
          page,
          section === 'staff'
            ? 'adminNavStaff'
            : section === 'doctors'
              ? 'adminNavDoctors'
              : 'adminNavSettings',
          locale,
        );
        await shot(page, `${section}-${name}-${locale}`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const section of ['staff', 'doctors', 'settings'] as const) {
      await nav(
        page,
        section === 'staff'
          ? 'adminNavStaff'
          : section === 'doctors'
            ? 'adminNavDoctors'
            : 'adminNavSettings',
        locale,
      );
      await page
        .locator('.admin-workspace')
        .first()
        .evaluate((node) => {
          const element = node as HTMLElement;
          element.style.zoom = '2';
        });
      await shot(page, `${section}-scale-200-${locale}`);
      const layout = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        overflowing: [...document.querySelectorAll('body *')]
          .filter(
            (node) =>
              node.getBoundingClientRect().right > innerWidth &&
              !node.closest('.admin-table-scroll'),
          )
          .map((node) => ({
            tag: node.tagName,
            className: node.className,
            right: node.getBoundingClientRect().right,
            text: node.textContent?.slice(0, 80),
          })),
        boxes: [
          ...document.querySelectorAll(
            '.cf-header, .cf-body, .cf-main, .admin-management, .admin-management > *, .admin-list-tools, .admin-table-scroll',
          ),
        ].map((node) => ({
          className: node.className,
          right: node.getBoundingClientRect().right,
          width: node.getBoundingClientRect().width,
          scroll: node.scrollWidth,
        })),
      }));
      expect(layout.scroll, JSON.stringify(layout)).toBeLessThanOrEqual(layout.width);
      await page
        .locator('.admin-workspace')
        .first()
        .evaluate((node) => {
          const element = node as HTMLElement;
          element.style.zoom = '';
        });
    }
    await nav(page, 'adminNavSettings', locale);
    await page.getByTestId('settings-group-profile').click();
    await page
      .getByTestId('settings-profile')
      .getByRole('textbox', { name: CONSOLE.settingsNameEn[locale], exact: true })
      .fill('Unsaved hospital (Demo)');
    await expect(page.getByTestId('management-unsaved')).toBeVisible();
    await page.locator('.cf-help-button').click();
    await shot(page, `settings-help-${locale}`);
    await page.keyboard.press('Escape');
    await expect(
      page
        .getByTestId('settings-profile')
        .getByRole('textbox', { name: CONSOLE.settingsNameEn[locale], exact: true }),
    ).toHaveValue('Unsaved hospital (Demo)');
    await axe(page);
    await navLeaving(page, locale);
    await shot(page, `settings-dirty-${locale}`);
    await page.getByTestId('management-confirm-cancel').click();
    await expect(page.getByTestId('settings-profile')).toBeVisible();
    await page.getByTestId('management-discard').click();
    await review(page);
    await expect(page.getByTestId('management-unsaved')).not.toBeVisible();
    // Original deep links must select a valid pane without leaking its subgroup
    // into another primary section. Unknown tabs retain the settings home.
    for (const tab of ['departments', 'beds', 'unknown-tab']) {
      await page.goto(`http://localhost:3100/?view=settings&tab=${tab}`);
      await expect(
        page.getByTestId(
          tab === 'departments'
            ? 'settings-departments'
            : tab === 'beds'
              ? 'settings-add-ward'
              : 'settings-status',
        ),
      ).toBeVisible();
      await nav(page, 'adminNavStaff', locale);
      await expect(page.getByTestId('management-add')).toBeVisible();
      await nav(page, 'adminNavDoctors', locale);
      await expect(page.getByTestId('management-search')).toBeVisible();
      await nav(page, 'adminNavSettings', locale);
      await expect(page.getByTestId('settings-status')).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
async function navLeaving(page: Page, locale: 'bn' | 'en') {
  await page
    .locator('.cf-nav')
    .getByRole('button', { name: CONSOLE.adminNavDoctors[locale] })
    .click();
  await expect(page.getByTestId('management-confirm')).toBeVisible();
}

test('multi-desk partial failure, authoritative reconciliation and retry only remaining writes', async ({
  page,
}) => {
  const fixture = await setup(page);
  await nav(page, 'adminNavStaff');
  await page.getByTestId(`management-change-${fixture.receptionist.id}`).click();
  await page.getByTestId(`staff-assignment-${fixture.deskIds[0]}`).uncheck();
  await page.getByTestId(`staff-assignment-${fixture.deskIds[1]}`).check();
  await page.getByTestId(`staff-assignment-${fixture.deskIds[2]}`).check();
  const writes: string[] = [];
  let failed = false;
  await page.route('**/hospital/desks/*', async (route) => {
    if (route.request().method() !== 'PATCH') return await route.continue();
    const id = route.request().url().split('/').at(-1)!;
    writes.push(id);
    if (writes.length === 2 && !failed) {
      failed = true;
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'SETTINGS_NOT_ALLOWED',
            message: 'Desk changed',
            details: { reason: 'desk_changed' },
          },
        }),
      });
    } else await route.continue();
  });
  await page.getByTestId('staff-assignments-save').click();
  await review(page);
  await expect(page.getByTestId('staff-assignment-results')).toContainText(
    CONSOLE.managePending.en,
  );
  await expect(page.getByTestId('staff-assignment-results')).toContainText('Rejected');
  expect(writes).toHaveLength(2);
  await shot(page, 'desk-partial-failure-en');
  const completed = writes[0];
  await page.getByTestId('staff-assignments-save').click();
  await review(page);
  await expect.poll(() => writes.length).toBe(4);
  expect(writes.slice(2)).not.toContain(completed);
  await expect(page.getByTestId('staff-assignment-results')).toContainText('Confirmed');
  await expect(page.getByTestId('management-unsaved')).not.toBeVisible();
  await shot(page, 'desk-recovered-en');
  const response = await page.request.get(`${API}/hospital/desks`, {
    headers: { Authorization: `Bearer ${fixture.token}` },
  });
  const data = (await response.json()) as { data: { desks: { id: string; staffIds: string[] }[] } };
  expect(
    data.data.desks
      .filter((d) => d.staffIds.includes(fixture.receptionist.id))
      .map((d) => d.id)
      .sort(),
  ).toEqual(fixture.deskIds.slice(1).sort());
});

test('rules field validation, cancelled review, failed save retains draft, offline and server-confirmed read-back', async ({
  page,
  context,
}) => {
  await setup(page);
  await nav(page, 'adminNavSettings');
  await page.getByTestId('settings-group-rules').click();
  const field = page
    .getByTestId('settings-rules')
    .getByLabel(CONSOLE.settingsGracePatients.en, { exact: true });
  await field.fill('21');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('settings-save-rules')).toBeDisabled();
  await shot(page, 'rules-invalid-en');
  await field.fill('9');
  await page.getByTestId('settings-save-rules').click();
  await page.getByTestId('management-confirm-cancel').click();
  await expect(field).toHaveValue('9');
  await page.route('**/hospital/rules', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Synthetic failure' } }),
    }),
  );
  await page.getByTestId('settings-save-rules').click();
  await review(page);
  await expect(page.getByTestId('management-unsaved')).toBeVisible();
  await expect(field).toHaveValue('9');
  await shot(page, 'rules-failed-en');
  await page.unroute('**/hospital/rules');
  await context.setOffline(true);
  await expect(page.getByTestId('settings-save-rules')).toBeDisabled();
  await shot(page, 'rules-offline-en');
  await context.setOffline(false);
  await expect(page.getByTestId('settings-save-rules')).toBeEnabled();
  await page.getByTestId('settings-save-rules').click();
  await review(page);
  await expect(page.getByTestId('management-unsaved')).not.toBeVisible();
  await expect(field).toHaveValue('9');
  await shot(page, 'rules-saved-en');
});

test('a newer server response wins; a dirty form survives concurrent changes until explicit discard', async ({
  page,
}) => {
  const fixture = await setup(page);
  await nav(page, 'adminNavSettings');
  await page.getByTestId('settings-group-profile').click();
  const field = page
    .getByTestId('settings-profile')
    .getByRole('textbox', { name: CONSOLE.settingsNameEn.en, exact: true });
  await field.fill('Local draft (Demo)');
  const headers = { Authorization: `Bearer ${fixture.token}` };
  const original = (await (
    await page.request.get(`${API}/hospital/setup`, { headers })
  ).json()) as unknown;
  let requests = 0;
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let completed: (() => void) | undefined;
  const oldCompleted = new Promise<void>((resolve) => {
    completed = resolve;
  });
  let fresh: unknown = original;
  await page.route('**/hospital/setup', async (route) => {
    requests++;
    if (requests === 1) {
      await held;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(original),
      });
      completed?.();
    } else
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fresh),
      });
  });
  await page.evaluate(() => globalThis.dispatchEvent(new Event('online')));
  await expect.poll(() => requests).toBe(1);
  const changed = await page.request.patch(`${API}/hospital/profile`, {
    headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
    data: { nameEn: 'Server revision (Demo)' },
  });
  expect(changed.ok()).toBe(true);
  fresh = (await (await page.request.get(`${API}/hospital/setup`, { headers })).json()) as unknown;
  await page.evaluate(() => globalThis.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('management-unsaved')).toContainText(
    CONSOLE.manageServerChanged.en,
  );
  release?.();
  await oldCompleted;
  await expect(field).toHaveValue('Local draft (Demo)');
  await expect(page.getByTestId('settings-save-profile')).toBeDisabled();
  await shot(page, 'profile-concurrent-change-en');
  await page.getByTestId('management-discard').click();
  await page.getByTestId('management-confirm-cancel').click();
  await expect(field).toHaveValue('Local draft (Demo)');
  await page.getByTestId('management-discard').click();
  await review(page);
  await expect(field).toHaveValue('Server revision (Demo)');
  await expect(page.getByTestId('management-unsaved')).not.toBeVisible();
});
