/**
 * `e2e/hospital-settings.spec.ts` — a facility sets itself up (pilot step 22,
 * `S-B-11`, `FR-SUP-01`, `FR-ADM-11`).
 *
 * The step is done when "a hospital with no seed data can be set up from the
 * screen and its chambers appear for the next seven days". So the facility
 * here starts as `pnpm staff:create` leaves one — a name, a code and one
 * administrator — and everything else is typed into the settings screen:
 * a department, a doctor and a weekly chamber, a ward and its beds, the
 * emergency services it offers, and a receptionist who then signs in with the
 * temporary password the screen showed once. Going live publishes it, and
 * the chamber appears in the patient app's own discovery API.
 */

import { expect, test, type Browser, type Page } from '@playwright/test';

import { closeOtherContexts } from './support/contexts.js';
import {
  bedStates,
  chamberDates,
  newFacility,
  removeFacility,
  verifyDoctor,
  type NewFacility,
} from './support/facility.js';

const CONSOLE = 'http://localhost:3100';
const API = 'http://localhost:4000/api/v1';
const PASSWORD = 'settings-e2e-password';

/** ISO weekday (1 = Monday) to the chip's Bangla name. */
const DAY_NAME: Readonly<Record<number, string>> = {
  1: 'সোমবার',
  2: 'মঙ্গলবার',
  3: 'বুধবার',
  4: 'বৃহস্পতিবার',
  5: 'শুক্রবার',
  6: 'শনিবার',
  7: 'রবিবার',
};

/** Tomorrow in Dhaka: its date and ISO weekday. Tomorrow, so the chamber is always ahead. */
function tomorrowInDhaka(): { date: string; weekday: number } {
  const at = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
  const short = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Dhaka',
    weekday: 'short',
  }).format(at);
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(short) + 1;
  return { date, weekday };
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto(`${CONSOLE}/?login=1`);
  await expect(page.getByTestId('staff-login')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
}

async function tab(page: Page, id: string): Promise<void> {
  await page.getByTestId(`settings-tab-${id}`).click();
}

const made: NewFacility[] = [];

test.afterAll(async () => {
  for (const facility of made) await removeFacility(facility.hospitalId);
});

async function openSettings(page: Page, facility: NewFacility): Promise<void> {
  await signIn(page, facility.adminEmail, PASSWORD);
  await page.getByTestId(`open-admin-${facility.hospitalId}`).click();
  await expect(page.getByTestId('admin-dashboard')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('admin-open-settings').click();
  await expect(page.getByTestId('hospital-settings')).toBeVisible({ timeout: 30_000 });
}

// Second devices close after each test, or their pages poll the API for the
// rest of the run (`support/contexts.ts`).
test.afterEach(async ({ browser, context }) => {
  await closeOtherContexts(browser, context);
});

test.describe('S-B-11: a facility with no seed data sets itself up', () => {
  test.setTimeout(180_000);

  test('from an empty facility to a live chamber, a ward, and a receptionist who can sign in', async ({
    page,
    browser,
  }) => {
    const facility = await newFacility(PASSWORD);
    made.push(facility);
    const tomorrow = tomorrowInDhaka();
    const bmdc = `A-${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;

    // --- in, and to the settings -------------------------------------------
    await openSettings(page, facility);
    await expect(page.getByTestId('settings-not-live')).toBeVisible();

    // Nothing to publish yet, and the screen says what to add.
    await tab(page, 'departments');
    await expect(page.getByTestId('settings-departments-empty')).toBeVisible();

    // --- a department ------------------------------------------------------
    const department = page.getByTestId('settings-add-department');
    await department.getByLabel('নাম (বাংলায়)').fill('মেডিসিন (ডেমো)');
    await department.getByLabel('নাম (ইংরেজিতে)').fill('Medicine (Demo)');
    await department.getByLabel(/^কোড/).fill('med');
    await page.getByTestId('settings-add-department-submit').click();
    await expect(page.getByTestId('settings-departments')).toContainText('MED');

    // --- a doctor and a weekly chamber -------------------------------------
    await tab(page, 'doctors');
    const doctor = page.getByTestId('settings-add-doctor');
    await doctor.getByLabel('নাম (বাংলায়)').fill('ডা. নতুন (ডেমো)');
    await doctor.getByLabel('নাম (ইংরেজিতে)').fill('Dr New (Demo)');
    await doctor.getByLabel('বিএমডিসি নম্বর').fill(bmdc);
    await doctor.getByLabel('ফি (টাকা)').fill('৮০০');
    await page.getByTestId('settings-add-doctor-submit').click();

    const card = page.locator('[data-testid^="settings-doctor-"]').filter({ hasText: bmdc });
    await expect(card).toBeVisible();
    await expect(card).toContainText('যাচাই বাকি');

    const day = DAY_NAME[tomorrow.weekday];
    if (day === undefined) throw new Error(`no day name for weekday ${tomorrow.weekday}`);
    const schedule = card.locator('[data-testid^="settings-add-schedule-"]').first();
    await schedule.getByRole('button', { name: day }).click();
    await schedule.getByLabel(/^শুরু/).fill('17:00');
    await schedule.getByLabel(/^শেষ/).fill('21:00');
    await card.locator('[data-testid^="settings-add-schedule-submit-"]').click();
    await expect(card.locator('[data-testid^="settings-schedules-"]')).toContainText(day);

    // Its chambers exist at once, not at the next hourly run: tomorrow is the
    // one day of the coming eight on that weekday.
    expect(await chamberDates(facility.hospitalId)).toEqual([tomorrow.date]);

    // --- a ward and its beds, never falsely free ---------------------------
    await tab(page, 'beds');
    const ward = page.getByTestId('settings-add-ward');
    await ward.getByLabel('নাম (বাংলায়)').fill('সাধারণ ওয়ার্ড (ডেমো)');
    await ward.getByLabel('নাম (ইংরেজিতে)').fill('General Ward (Demo)');
    await ward.getByLabel('তলা').fill('3');
    await page.getByTestId('settings-add-ward-submit').click();
    const wardCard = page.locator('[data-testid^="settings-ward-"]').first();
    await expect(wardCard).toBeVisible();
    await wardCard.getByLabel('বেড নম্বর').fill('301-303');
    await wardCard.getByLabel('প্রতি রাতের ভাড়া (টাকা)').fill('1500');
    await wardCard.locator('[data-testid^="settings-add-beds-"]').click();
    await expect(wardCard).toContainText('303');
    expect(await bedStates(facility.hospitalId)).toEqual([
      'out_of_service',
      'out_of_service',
      'out_of_service',
    ]);

    // --- emergency services offered ----------------------------------------
    await tab(page, 'capabilities');
    await page
      .getByTestId('settings-capabilities')
      .getByRole('button', { name: 'বার্ন ইউনিট' })
      .click();
    await page.getByTestId('settings-save-capabilities').click();
    await expect(page.getByTestId('settings-capabilities')).toContainText('এখন বন্ধ');

    // --- a receptionist, with a password shown once ------------------------
    await tab(page, 'staff');
    const email = `reception-${facility.code.toLowerCase()}@settings.demo.invalid`;
    const staff = page.getByTestId('settings-add-staff');
    await staff.getByLabel('পুরো নাম').fill('রিসেপশন (ডেমো)');
    await staff.getByLabel('ইমেইল').fill(email);
    await page.getByTestId('settings-add-staff-submit').click();
    const temporary =
      (await page.getByTestId('settings-temp-password-value').textContent())?.trim() ?? '';
    expect(temporary.length).toBeGreaterThanOrEqual(12);
    await receptionistSignsIn(browser, email, temporary);

    // --- publishing --------------------------------------------------------
    // The platform checks the BMDC register (`FR-SUP-02`); then the
    // administrator publishes, and the chamber reaches the patient app.
    await verifyDoctor(bmdc);
    await page.getByTestId('settings-go-live').click();
    await expect(page.getByTestId('settings-live')).toBeVisible();

    const published = await fetch(`${API}/sessions?hospitalId=${facility.hospitalId}`);
    const body = (await published.json()) as { data: { sessions: { sessionDate?: string }[] } };
    expect(body.data.sessions.length).toBeGreaterThanOrEqual(1);
  });
});

test.describe('S-B-11 with the connection gone (GR-03)', () => {
  test.setTimeout(120_000);

  test('keeps what it read, says it is offline, and will not pretend to save', async ({
    page,
    context,
  }) => {
    const facility = await newFacility(PASSWORD);
    made.push(facility);
    await openSettings(page, facility);
    await tab(page, 'departments');

    await context.setOffline(true);
    await expect(page.getByTestId('settings-offline-banner')).toBeVisible();
    // Still on screen: what was read before the connection went.
    await expect(page.getByTestId('settings-departments-empty')).toBeVisible();
    const save = page.getByTestId('settings-add-department-submit');
    await expect(save).toBeDisabled();
    await expect(save).toHaveAttribute('title', 'সংরক্ষণ করতে ইন্টারনেট সংযোগ লাগবে');

    await context.setOffline(false);
    await expect(page.getByTestId('settings-offline-banner')).toHaveCount(0);
  });
});

/** On another device: the receptionist signs in and is asked for their own password. */
async function receptionistSignsIn(
  browser: Browser,
  email: string,
  password: string,
): Promise<void> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await signIn(page, email, password);
    await expect(page.getByTestId('change-password')).toBeVisible({ timeout: 30_000 });
  } finally {
    await context.close();
  }
}
