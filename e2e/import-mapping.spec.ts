/**
 * `S-B-14`, the mapping step — a hospital uploads its own export and matches
 * its columns to ours (`PRD.md` §14b `FR-IMP-13`–`20`).
 *
 * The onboarding claim, on a screen: a patient register in the hospital's own
 * column names is read, each column is proposed for the right field with a
 * reason, an administrator corrects one choice by hand and confirms, and from
 * there it is the importer that already exists — checked, previewed, approved.
 * The second time the same export arrives it maps itself.
 *
 * No model is involved: this is the rules and a person (`FR-IMP-15`,
 * `FR-IMP-18`). Every file is synthetic (`FR-IMP-11`, `FR-SEC-08`).
 */

import { expect, test, type Page } from '@playwright/test';

import { newFacility, removeFacility, type NewFacility } from './support/facility.js';
import { passSecondFactor } from './support/twoFactor.js';

const CONSOLE = 'http://localhost:3100';
const PASSWORD = 'mapping-e2e-password';

/** A patient register as a hospital's own system exports it. */
const REGISTER = [
  'Patient ID,Patient Name,DOB,Gender,Contact No,Blood Grp,Address,NID',
  'P-1001,Rahima Khatun (Demo),05/03/1988,F,01712345678,B+,"House 4, Mirpur",1234567890',
  'P-1002,Karim Uddin (Demo),12/11/1975,M,01812345678,O+,"Road 7, Dhanmondi",2345678901',
  'P-1003,Salma Begum (Demo),01/01/1990,Female,01912345678,A+,Uttara,3456789012',
].join('\r\n');

/** The same export a month later: the same headings, other rows. */
const NEXT_MONTH = [
  'Patient ID,Patient Name,DOB,Gender,Contact No,Blood Grp,Address,NID',
  'P-1004,Nasima Akter (Demo),09/09/1995,F,01612345678,AB+,Banani,4567890123',
].join('\r\n');

/** A file with no heading row: its first line is a patient. */
const NO_HEADINGS = [
  'P-1001,Rahima Khatun (Demo),05/03/1988,F,01712345678',
  'P-1002,Karim Uddin (Demo),12/11/1975,M,01812345678',
].join('\r\n');

/** Headings no rule knows, except the one phone column. */
const AWKWARD = [
  'MR#,Pt. Nm,Yrs,Sx,Pt. Cell,Vill,Father',
  'M-1,Rahima Khatun (Demo),38,F,01712345678,Mirpur,Abdul Karim (Demo)',
  'M-2,Karim Uddin (Demo),51,M,01812345678,Dhanmondi,Rahim Uddin (Demo)',
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
  await passSecondFactor(page, facility.adminEmail);
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

/** The heading of the file column chosen for a field. */
async function chosenFor(page: Page, field: string): Promise<string> {
  return await page
    .getByTestId(`map-${field}`)
    .evaluate((select) => (select as HTMLSelectElement).selectedOptions[0]?.textContent ?? '');
}

test.describe('S-B-14: a hospital’s own export, mapped (FR-IMP-13 to FR-IMP-20)', () => {
  test.setTimeout(180_000);

  test('read, proposed with reasons, corrected by hand, confirmed, checked, approved, remembered', async ({
    page,
  }) => {
    const facility = await newFacility(PASSWORD);
    made.push(facility);
    await openImport(page, facility);

    // The screen says its own file is welcome before one is chosen.
    await expect(page.getByTestId('import-own-file')).toBeVisible();

    await page.getByRole('button', { name: 'খ রোগীর তালিকা' }).click();
    await choose(page, 'patient-register.csv', REGISTER);
    await page.getByTestId('import-check').click();

    // --- the mapping step opens, and nothing has been checked or saved --------
    const mapping = page.getByTestId('import-mapping');
    await expect(mapping).toBeVisible();
    await expect(page.getByTestId('import-preview')).toHaveCount(0);
    await expect(mapping).toContainText('৩টি সারি');

    // --- each field has the right column, with where it came from and why -----
    expect(await chosenFor(page, 'ref')).toBe('Patient ID');
    expect(await chosenFor(page, 'full_name')).toBe('Patient Name');
    expect(await chosenFor(page, 'date_of_birth')).toBe('DOB');
    expect(await chosenFor(page, 'sex')).toBe('Gender');
    expect(await chosenFor(page, 'mobile')).toBe('Contact No');
    expect(await chosenFor(page, 'blood_group')).toBe('Blood Grp');

    const whyMobile = page.getByTestId('map-why-mobile');
    await expect(whyMobile).toContainText('নিয়ম থেকে প্রস্তাব');
    await expect(whyMobile).toContainText('নিশ্চয়তা বেশি');
    await expect(whyMobile).toContainText('পরিচিত নাম');
    // What the column was found to hold, never what is in it.
    await expect(page.getByTestId('map-holds-mobile')).toContainText('ফোন নম্বর');
    await expect(page.getByTestId('map-holds-mobile')).toContainText('১০০%');
    await expect(mapping).not.toContainText('01712345678');
    await expect(mapping).not.toContainText('Rahima');

    // No age column in this file, and none is needed: there is a birth date.
    expect(await chosenFor(page, 'age_years')).toBe('এই তথ্য নেওয়া হবে না');
    await expect(page.getByTestId('map-why-age_years')).toContainText('কোনো কলাম মেলেনি');

    // --- what stays behind is named (FR-IMP-02, FR-IMP-18) ---------------------
    await expect(page.getByTestId('map-not-imported')).toContainText('Address');
    await expect(page.getByTestId('map-not-imported')).toContainText('NID');

    // --- a required field with no column blocks confirmation, by name ---------
    await page.getByTestId('map-sex').selectOption('');
    await expect(page.getByTestId('map-confirm')).toBeDisabled();
    await expect(page.getByTestId('map-missing')).toContainText('লিঙ্গ');
    await page.getByTestId('map-sex').selectOption({ label: 'Gender' });
    await expect(page.getByTestId('map-missing')).toHaveCount(0);

    // --- one choice made by hand: leave the blood group out -------------------
    await page.getByTestId('map-blood_group').selectOption('');
    await expect(page.getByTestId('map-not-imported')).toContainText('Blood Grp');
    // And one changed and changed back is the person's, said so.
    await page.getByTestId('map-ref').selectOption({ label: 'NID' });
    await expect(page.getByTestId('map-why-ref')).toContainText('আপনি বেছে নিয়েছেন');
    await page.getByTestId('map-ref').selectOption({ label: 'Patient ID' });

    // --- confirm: the ordinary check and preview take over (FR-IMP-19) --------
    await page.getByTestId('map-confirm').click();
    await expect(page.getByTestId('import-preview')).toBeVisible();
    await expect(mapping).toHaveCount(0);
    await expect(page.getByTestId('import-count-add')).toContainText('৩');
    await expect(page.getByTestId('import-count-error')).toContainText('০');

    // Approved like any import.
    await page.getByTestId('import-commit').click();
    await page.getByTestId('import-confirm-yes').click();
    await expect(page.getByText('আমদানি সংরক্ষণ করা হয়েছে').first()).toBeVisible();

    // --- the same export next month maps itself (FR-IMP-20) --------------------
    await choose(page, 'patient-register-next-month.csv', NEXT_MONTH);
    await page.getByTestId('import-check').click();
    await expect(mapping).toBeVisible();
    await expect(page.getByTestId('map-from-saved')).toBeVisible();
    expect(await chosenFor(page, 'ref')).toBe('Patient ID');
    // Including the choice made by hand: the blood group is still left out.
    expect(await chosenFor(page, 'blood_group')).toBe('এই তথ্য নেওয়া হবে না');
    await expect(page.getByTestId('map-why-mobile')).toContainText('আগের নিশ্চিত করা মিল');

    await page.getByTestId('map-confirm').click();
    await expect(page.getByTestId('import-count-add')).toContainText('১');
    await page.getByTestId('import-discard').click();
  });

  test('a file with no heading row is stopped, and the patient in its first line is not shown', async ({
    page,
  }) => {
    const facility = await newFacility(PASSWORD);
    made.push(facility);
    await openImport(page, facility);

    await page.getByRole('button', { name: 'খ রোগীর তালিকা' }).click();
    await choose(page, 'no-headings.csv', NO_HEADINGS);
    await page.getByTestId('import-check').click();

    await expect(page.getByTestId('import-problem')).toContainText('প্রথম সারিতে কলামের নাম');
    await expect(page.getByTestId('import-mapping')).toHaveCount(0);
    await expect(page.getByTestId('hospital-import')).not.toContainText('Rahima');
  });

  test('a structure file says what it is a list of, and takes a correction', async ({ page }) => {
    const facility = await newFacility(PASSWORD);
    made.push(facility);
    await openImport(page, facility);

    const doctors = [
      'Doctor ID,Doctor Name,Bangla Name,BMDC Reg No,Department,Consultation Fee',
      'D-1,Dr Mapped (Demo),ডা. ম্যাপড (ডেমো),A-7654321,MED,800',
    ].join('\r\n');
    await choose(page, 'doctors.csv', doctors);
    await page.getByTestId('import-check').click();

    const mapping = page.getByTestId('import-mapping');
    await expect(mapping).toBeVisible();
    // Guessed from the headings: a list of doctors.
    const rowType = page.getByTestId('map-row-type');
    await expect(rowType.getByRole('button', { name: 'ডাক্তার', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await chosenFor(page, 'bmdc_number')).toBe('BMDC Reg No');
    expect(await chosenFor(page, 'fee_taka')).toBe('Consultation Fee');

    // A person can say otherwise, and the fields follow.
    await rowType.getByRole('button', { name: 'কর্মী', exact: true }).click();
    await expect(page.getByTestId('map-row-email')).toBeVisible();
    await expect(page.getByTestId('map-row-bmdc_number')).toHaveCount(0);
    await expect(page.getByTestId('map-confirm')).toBeDisabled();

    await page.getByTestId('map-cancel').click();
    await expect(mapping).toHaveCount(0);
  });

  /**
   * The model's part on the screen (`FR-IMP-16`, `FR-IMP-17`).
   *
   * No test calls a model. The server here has none configured, so the answer
   * to `analyse` is the rules' own, and this stands in for the model by
   * adding to that answer what one would add: suggestions for the fields the
   * rules left open, marked as the model's. What the model adapter sends and
   * accepts is `mappingProvider.test.ts` and `importMapping.routes.test.ts`;
   * this is how an administrator is shown it.
   */
  test('a model’s suggestions are shown as suggestions, with what the model was not given', async ({
    page,
  }) => {
    const facility = await newFacility(PASSWORD);
    made.push(facility);
    await openImport(page, facility);

    const suggested: Record<string, { column: number; note: string; confidence: number }> = {
      ref: { column: 0, note: 'MR# is a medical record number.', confidence: 0.8 },
      full_name: { column: 1, note: 'Pt. Nm abbreviates patient name.', confidence: 0.8 },
      age_years: { column: 2, note: 'Yrs is age in years.', confidence: 0.65 },
      sex: { column: 3, note: 'Sx abbreviates sex.', confidence: 0.5 },
    };
    await page.route('**/hospital/imports/analyse', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as {
        data: { model: string; proposal: { field: string; column: number | null }[] };
      };
      body.data.model = 'used';
      body.data.proposal = body.data.proposal.map((entry) => {
        const suggestion = suggested[entry.field];
        return suggestion === undefined || entry.column !== null
          ? entry
          : { ...entry, ...suggestion, source: 'model', reason: null };
      });
      await route.fulfill({ response, json: body });
    });

    let confirmedBody: { suggestedByModel?: string[] } | null = null;
    page.on('request', (request) => {
      if (request.url().endsWith('/hospital/imports/mapped')) {
        confirmedBody = request.postDataJSON() as { suggestedByModel?: string[] };
      }
    });

    await page.getByRole('button', { name: 'খ রোগীর তালিকা' }).click();
    await choose(page, 'awkward-register.csv', AWKWARD);
    await page.getByTestId('import-check').click();

    const mapping = page.getByTestId('import-mapping');
    await expect(mapping).toBeVisible();

    // Said at the top: these are suggestions, and no row went to the model.
    const banner = page.getByTestId('map-model-used');
    await expect(banner).toContainText('শুধু প্রস্তাব');
    await expect(banner).toContainText('কোনো সারি এআইকে পাঠানো হয়নি');

    // A suggested field: whose suggestion, how sure, and why in its own words.
    expect(await chosenFor(page, 'ref')).toBe('MR#');
    const whyRef = page.getByTestId('map-why-ref');
    await expect(whyRef).toContainText('এআইয়ের প্রস্তাব');
    await expect(whyRef).toContainText('MR# is a medical record number.');
    // A low-confidence one asks to be looked at.
    await expect(page.getByTestId('map-why-sex')).toContainText('দেখে নিন');
    // The rule's own choice is still the rule's.
    await expect(page.getByTestId('map-why-mobile')).toContainText('নিয়ম থেকে প্রস্তাব');
    // What stays behind is still named.
    await expect(page.getByTestId('map-not-imported')).toContainText('Father');

    // Overruling the model makes the choice the administrator's.
    await page.getByTestId('map-age_years').selectOption('');
    await page.getByTestId('map-age_years').selectOption({ label: 'Yrs' });
    await page.getByTestId('map-sex').selectOption({ label: 'Vill' });
    await expect(page.getByTestId('map-why-sex')).toContainText('আপনি বেছে নিয়েছেন');
    await page.getByTestId('map-sex').selectOption({ label: 'Sx' });

    // Confirming is still the administrator's act, and the check still decides.
    await page.getByTestId('map-confirm').click();
    await expect(page.getByTestId('import-preview')).toBeVisible();
    await expect(page.getByTestId('import-count-add')).toContainText('২');
    await expect(page.getByTestId('import-count-error')).toContainText('০');

    // The audit is told which fields still hold what the model suggested.
    expect(confirmedBody).not.toBeNull();
    expect([...(confirmedBody?.suggestedByModel ?? [])].sort()).toEqual([
      'age_years',
      'full_name',
      'ref',
      'sex',
    ]);
    await page.getByTestId('import-discard').click();
  });

  test('when the model cannot answer, the screen says so and the import carries on', async ({
    page,
  }) => {
    const facility = await newFacility(PASSWORD);
    made.push(facility);
    await openImport(page, facility);

    await page.route('**/hospital/imports/analyse', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { data: { model: string } };
      body.data.model = 'unavailable';
      await route.fulfill({ response, json: body });
    });

    await page.getByRole('button', { name: 'খ রোগীর তালিকা' }).click();
    await choose(page, 'patient-register.csv', REGISTER);
    await page.getByTestId('import-check').click();

    await expect(page.getByTestId('map-model-unavailable')).toContainText(
      'নিয়ম ও আপনার নিজের বাছাই দিয়ে কাজ চলবে',
    );
    await expect(page.getByTestId('map-model-used')).toHaveCount(0);
    // The rules' proposal is all there, and confirming works as it does with no model.
    expect(await chosenFor(page, 'ref')).toBe('Patient ID');
    await page.getByTestId('map-confirm').click();
    await expect(page.getByTestId('import-count-add')).toContainText('৩');
    await page.getByTestId('import-discard').click();
  });
});
