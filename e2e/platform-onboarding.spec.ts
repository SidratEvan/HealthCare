/**
 * `S-B-12` — a hospital brought onto the platform from screens, with no
 * command line (`PRD.md` §14c `FR-ONB-01`, `04`–`06`, `08`; `FR-NET-03`).
 *
 * The onboarding story as it is told to a hospital: a platform administrator
 * creates the workspace and hands over a password; the hospital sets itself up
 * and asks for review; the platform verifies its doctor and approves; and only
 * then is the hospital in front of patients. Suspending takes it out again at
 * once.
 *
 * The hospital's own half of the story — the administrator filling `S-B-11`
 * in by hand and pressing "request review" — is `hospital-settings.spec.ts`.
 * Here that half is done through the API, as that administrator, so this spec
 * can stay on the two screens it is about: the platform's, and the patient's.
 */

import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { adminToken } from './support/console.js';
import { hospitalIdByCode, removeFacility } from './support/facility.js';

const CONSOLE = 'http://localhost:3100';
const PATIENT = 'http://localhost:3000';
const API = 'http://localhost:4000/api/v1';

const code = `ONB${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
const nameEn = `Onboarding ${code} Hospital (Demo)`;
const nameBn = `অনবোর্ডিং ${code} হাসপাতাল (ডেমো)`;
const bmdc = `A-${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;

let hospitalId: string | undefined;

async function asAdmin(path: string, body: object): Promise<Record<string, unknown>> {
  if (hospitalId === undefined) throw new Error('no hospital yet');
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await adminToken(hospitalId)}`,
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} answered ${String(response.status)}`);
  return ((await response.json()) as { data: Record<string, unknown> }).data;
}

/** The hospital's administrator sets the hospital up and asks for review. */
async function hospitalSetsUpAndAsks(): Promise<void> {
  const department = await asAdmin('/hospital/departments', {
    code: 'CARD',
    nameBn: 'কার্ডিওলজি (ডেমো)',
    nameEn: 'Cardiology (Demo)',
  });
  const doctor = await asAdmin('/hospital/doctors', {
    nameBn: 'ডা. অনবোর্ডিং (ডেমো)',
    nameEn: 'Dr Onboarding (Demo)',
    bmdcNumber: bmdc,
    specialties: ['cardiology'],
    departmentId: department['departmentId'],
    feePoisha: 80_000,
    room: '101',
  });
  await asAdmin('/hospital/templates', {
    doctorHospitalId: doctor['doctorHospitalId'],
    weekday: 1,
    startTime: '17:00',
    endTime: '20:00',
    capacity: 20,
  });
  await asAdmin('/hospital/request-review', {});
}

async function openPlatform(page: Page): Promise<void> {
  await page.goto(CONSOLE);
  await expect(page.getByTestId('console-picker')).toBeVisible();
  await page.getByTestId('open-platform').click();
  await expect(page.getByTestId('platform-console')).toBeVisible();
  await expect(page.getByTestId('platform-list')).toBeVisible();
}

/** Whether the patient app's search finds the hospital by its name. */
async function patientFindsIt(page: Page): Promise<boolean> {
  await page.goto(`${PATIENT}/search?q=${encodeURIComponent(`Onboarding ${code}`)}`);
  const found = page.locator('[data-testid^="result-hospital-"]');
  const empty = page.getByTestId('search-empty');
  await expect(found.first().or(empty)).toBeVisible();
  return (await found.count()) > 0;
}

test.afterAll(async () => {
  if (hospitalId !== undefined) await removeFacility(hospitalId);
});

test('a hospital goes from nothing to live to suspended, on screens (FR-ONB-01, 04, 05, 06)', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const patient = await (await browser.newContext()).newPage();

  // --- the platform's screen: organisations and counts, no patient ----------
  await openPlatform(page);
  await expect(page.getByTestId('platform-no-patients')).toContainText('কোনো রোগীর তথ্য এখানে নেই');
  // The six demo hospitals, each live.
  const rows = page.locator('[data-testid^="platform-row-"]');
  expect(await rows.count()).toBeGreaterThanOrEqual(6);
  await expect(page.getByTestId('platform-row-PADMA')).toHaveAttribute('data-lifecycle', 'active');

  // --- create the workspace and its first administrator (FR-ONB-01) ---------
  await page.getByTestId('platform-new').click();
  const form = page.getByTestId('platform-new-form');
  // Off, with a reason, until the form can be sent.
  await expect(page.getByTestId('platform-create')).toBeDisabled();
  await form.getByLabel('হাসপাতালের নাম (বাংলা)').fill(nameBn);
  await form.getByLabel('হাসপাতালের নাম (ইংরেজি)').fill(nameEn);
  await form.getByLabel('হাসপাতালের কোড').fill(code.toLowerCase());
  await form.getByLabel('নিবন্ধন বা লাইসেন্স নম্বর').fill('DGHS-DEMO-0002');
  await form.getByLabel('জেলা').fill('Dhaka');
  await form.getByLabel('প্রথম প্রশাসকের নাম').fill('প্রশাসক (ডেমো)');
  await form
    .getByLabel('প্রথম প্রশাসকের ইমেইল')
    .fill(`admin-${code.toLowerCase()}@onboarding.demo.invalid`);
  await page.getByTestId('platform-create').click();

  // The temporary password, once, to be handed over.
  await expect(page.getByTestId('platform-created')).toBeVisible();
  const temporary = (await page.getByTestId('platform-temp-password').textContent())?.trim() ?? '';
  expect(temporary.length).toBeGreaterThanOrEqual(10);
  await page.getByTestId('platform-created-done').click();

  const workspace = page.getByTestId('platform-workspace');
  await expect(workspace).toHaveAttribute('data-lifecycle', 'setup');
  // Nothing to decide yet: it is the hospital's move.
  await expect(page.getByTestId('platform-no-actions')).toBeVisible();
  await expect(page.getByTestId(`platform-row-${code}`)).toHaveAttribute('data-lifecycle', 'setup');

  // Not in front of patients.
  expect(await patientFindsIt(patient)).toBe(false);

  hospitalId = await hospitalIdByCode(code);

  // --- the hospital sets itself up and asks (hospital-settings.spec.ts) ------
  await hospitalSetsUpAndAsks();
  expect(await patientFindsIt(patient)).toBe(false);

  // --- the request reaches the platform, at the top of its list --------------
  await page.reload();
  await expect(page.getByTestId('platform-waiting')).toBeVisible();
  await expect(rows.first()).toHaveAttribute('data-testid', `platform-row-${code}`);
  await page.getByTestId(`platform-row-${code}`).click();
  await expect(workspace).toHaveAttribute('data-lifecycle', 'ready_for_review');

  // It cannot be approved with no verified doctor, and the screen says why
  // before anybody presses anything (FR-SUP-02).
  await expect(page.getByTestId('platform-not-ready')).toContainText('যাচাই হওয়া ডাক্তার');
  await expect(page.getByTestId('platform-act-approve')).toBeDisabled();

  // --- verify the doctor against the register (FR-ONB-05) --------------------
  await page.getByTestId(`platform-verify-${bmdc}`).click();
  await expect(page.getByTestId(`platform-doctor-${bmdc}`)).toContainText('যাচাই হয়েছে');
  await expect(page.getByTestId('platform-not-ready')).toHaveCount(0);

  // --- approve: live, and in front of patients at once (FR-ONB-04) -----------
  await page.getByTestId('platform-act-approve').click();
  await expect(workspace).toHaveAttribute('data-lifecycle', 'active');
  await expect(page.getByTestId(`platform-row-${code}`)).toHaveAttribute(
    'data-lifecycle',
    'active',
  );
  expect(await patientFindsIt(patient)).toBe(true);

  // --- suspend: a reason is owed, and the hospital is out at once (FR-ONB-06) -
  await expect(page.getByTestId('platform-act-suspend')).toBeDisabled();
  await page.getByTestId('platform-note').fill('চুক্তি নবায়ন বাকি আছে।');
  await page.getByTestId('platform-act-suspend').click();
  await expect(workspace).toHaveAttribute('data-lifecycle', 'suspended');
  await expect(page.getByTestId('platform-last-note')).toContainText('চুক্তি নবায়ন বাকি আছে');
  expect(await patientFindsIt(patient)).toBe(false);

  // And back.
  await page.getByTestId('platform-act-reinstate').click();
  await expect(workspace).toHaveAttribute('data-lifecycle', 'active');
  expect(await patientFindsIt(patient)).toBe(true);
});

test('a code already in use is refused with a sentence, and nothing is created', async ({
  page,
}) => {
  await openPlatform(page);
  await page.getByTestId('platform-new').click();
  const form = page.getByTestId('platform-new-form');
  await form.getByLabel('হাসপাতালের নাম (বাংলা)').fill('আরেকটি পদ্মা (ডেমো)');
  await form.getByLabel('হাসপাতালের নাম (ইংরেজি)').fill('Another Padma (Demo)');
  await form.getByLabel('হাসপাতালের কোড').fill('PADMA');
  await form.getByLabel('জেলা').fill('Dhaka');
  await form.getByLabel('প্রথম প্রশাসকের নাম').fill('প্রশাসক (ডেমো)');
  await form.getByLabel('প্রথম প্রশাসকের ইমেইল').fill('someone@onboarding.demo.invalid');
  await page.getByTestId('platform-create').click();

  await expect(page.getByTestId('platform-form-problem')).toContainText('এই কোড আগে থেকেই আছে');
  await expect(page.getByTestId('platform-created')).toHaveCount(0);
});

test('offline, the list stays and every write is off with the reason (GR-03)', async ({
  page,
  context,
}) => {
  await openPlatform(page);
  await page.getByTestId('platform-row-PADMA').click();
  await expect(page.getByTestId('platform-workspace')).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByTestId('platform-offline')).toBeVisible();
  await expect(page.getByTestId('platform-list')).toBeVisible();
  await expect(page.getByTestId('platform-new')).toBeDisabled();
  await expect(page.getByTestId('platform-act-suspend')).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByTestId('platform-offline')).toHaveCount(0);
});

test('a hospital’s own administrator is not offered the platform’s screen', async ({ page }) => {
  // The door is for the national account alone; a hospital console opened
  // with `?view=platform` falls back to the picker.
  await page.goto(CONSOLE);
  await expect(page.getByTestId('console-picker')).toBeVisible();
  await page.goto(`${CONSOLE}/?view=platform`);
  await expect(page.getByTestId('platform-console')).toHaveCount(0);
});
