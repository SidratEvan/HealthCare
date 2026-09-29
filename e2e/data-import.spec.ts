/**
 * `e2e/data-import.spec.ts` — a hospital brings in what it already holds
 * (pilot step 24, `S-B-14`, `FR-IMP-01`…`09`).
 *
 * Done when "each set imports from its template, re-imports without
 * duplicates, and undoes". Through the browser, on a facility with nothing
 * but an administrator: the template downloads, a structure file is checked
 * and approved, the same file again only updates, a patient file with a
 * mistake names the row and cannot be approved, and the structure import is
 * taken back. Every file is synthetic (`FR-IMP-11`).
 */

import { expect, test, type Page } from '@playwright/test';

import { newFacility, removeFacility, type NewFacility } from './support/facility.js';

const CONSOLE = 'http://localhost:3100';
const PASSWORD = 'import-e2e-password';

const STRUCTURE = [
  'type,ref,name_bn,name_en,code,bmdc_number,degrees,specialties,department_ref,room,fee_taka,doctor_ref,weekday,start,end,serials,ward_ref,floor,bed_kind,bed_label,nightly_taka,role,email',
  'department,D-1,মেডিসিন (ডেমো),Medicine (Demo),MED,,,,,,,,,,,,,,,,,,',
  `doctor,DR-1,ডা. আমদানি (ডেমো),Dr Imported (Demo),,A-${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)},MBBS,medicine,D-1,12,800,,,,,,,,,,,,`,
  'ward,W-1,ওয়ার্ড (ডেমো),Ward (Demo),,,,,,,,,,,,,,2,general,,,,',
  'bed,B-201,,,,,,,,,,,,,,,W-1,,general,201,1500,,',
].join('\r\n');

const PATIENTS_WITH_A_MISTAKE = [
  'ref,full_name,date_of_birth,age_years,sex,mobile,blood_group',
  'P-1,আমদানি রোগী (ডেমো),01/02/1980,,F,01812345670,O+',
  'P-2,ভুল রোগী (ডেমো),,40,M,12345,',
].join('\r\n');

const made: NewFacility[] = [];

test.afterAll(async () => {
  for (const facility of made) await removeFacility(facility.hospitalId);
});

async function openImport(page: Page, facility: NewFacility): Promise<void> {
  await page.goto(`${CONSOLE}/?login=1`);
  await expect(page.getByTestId('staff-login')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId('login-email').fill(facility.adminEmail);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.getByTestId(`open-admin-${facility.hospitalId}`).click();
  await page.getByTestId('admin-open-settings').click();
  await page.getByTestId('settings-open-import').click();
  await expect(page.getByTestId('hospital-import')).toBeVisible({ timeout: 30_000 });
}

async function choose(page: Page, name: string, csv: string): Promise<void> {
  await page.getByTestId('import-file').setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  });
}

test.describe('S-B-14: a hospital imports its own data', () => {
  test.setTimeout(180_000);

  test('template, check, approve, re-import, a refused file, and taking it back', async ({
    page,
  }) => {
    const facility = await newFacility(PASSWORD);
    made.push(facility);
    await openImport(page, facility);

    // Empty: the templates are the call to action.
    await expect(page.getByTestId('import-empty')).toBeVisible();

    // BTN-B14-TEMPLATE: the set's template, as a file.
    const download = page.waitForEvent('download');
    await page.getByTestId('import-template').click();
    expect((await download).suggestedFilename()).toBe('healthwealthbd-structure-template.csv');

    // --- set A: checked, nothing written, then approved -----------------------
    await choose(page, 'structure.csv', STRUCTURE);
    await page.getByTestId('import-check').click();
    await expect(page.getByTestId('import-preview')).toBeVisible();
    await expect(page.getByTestId('import-count-add')).toContainText('৪');
    await expect(page.getByTestId('import-count-error')).toContainText('০');
    await page.getByTestId('import-commit').click();
    await page.getByTestId('import-confirm-yes').click();
    await expect(page.getByText('আমদানি সংরক্ষণ করা হয়েছে').first()).toBeVisible();

    // The same file again only updates (FR-IMP-04).
    await choose(page, 'structure-again.csv', STRUCTURE);
    await page.getByTestId('import-check').click();
    await expect(page.getByTestId('import-count-add')).toContainText('০');
    await expect(page.getByTestId('import-count-update')).toContainText('৪');
    await page.getByTestId('import-discard').click();

    // --- set B with a mistake: named, and cannot be approved -------------------
    await page.getByRole('button', { name: 'খ রোগীর তালিকা' }).click();
    await choose(page, 'patients.csv', PATIENTS_WITH_A_MISTAKE);
    await page.getByTestId('import-check').click();
    await expect(page.getByTestId('import-errors')).toContainText('mobile');
    await expect(page.getByTestId('import-errors')).toContainText('বাংলাদেশের মোবাইল নম্বর নয়');
    await expect(page.getByTestId('import-commit')).toBeDisabled();
    await page.getByTestId('import-discard').click();

    // --- taking set A back (FR-IMP-07) ------------------------------------------
    const committed = page.locator('[data-testid^="import-undo-"]').first();
    await committed.click();
    await page.getByTestId('import-confirm-yes').click();
    await expect(page.getByText('আমদানি ফিরিয়ে নেওয়া হয়েছে').first()).toBeVisible();
    await expect(page.getByTestId('import-history')).toContainText('ফিরিয়ে নেওয়া');
  });
});
