/**
 * `e2e/doctor-console.spec.ts` — `S-B-05` and the visit record (step 12).
 *
 * The step's definition of done is one sentence: *a visit writes a record into
 * the wallet*. That is what the last test here proves, end to end and through
 * the screens — a doctor types a diagnosis, taps sign, and the record is
 * readable afterwards as a record rather than as a row somebody inserted.
 *
 * ## Why signing is worth an end-to-end test of its own
 *
 * `BTN-B05-SIGN` is two things at once: it files a clinical record and it
 * advances a live queue (`FR-DOC-08`). Each half is covered by unit and API
 * tests. What only a browser can show is that they happen in the right order
 * from the doctor's point of view — the record saved, the next patient called,
 * and the note cleared for somebody new — and that a failure leaves the typing
 * where it was (`APP_FLOW.md` B2).
 */

import { expect, test, type Page } from '@playwright/test';

import { createConsoleSession, type ConsoleSession } from './support/console.js';
import { bengali } from './support/digits.js';

const CONSOLE = 'http://localhost:3100';

let demo: ConsoleSession;

test.beforeEach(async () => {
  // Six serials and serial 1 already in the chamber, which is the state a
  // doctor's screen is actually used in.
  demo = await createConsoleSession(6);
});

/**
 * Opens the doctor console on the fixture's chamber.
 *
 * The principal is written straight into `sessionStorage` under the one key
 * `ConsolePicker` uses, because the picker is `S-B-01` standing in for a login
 * (`CLAUDE.md` §4.1) and walking it here would be testing the picker.
 */
async function openDoctorConsole(page: Page): Promise<void> {
  await page.addInitScript(
    ([token, hospitalId]) => {
      sessionStorage.setItem(
        'console.demo-session',
        JSON.stringify({ token, hospitalId, staffName: 'Doctor (Demo)', role: 'doctor' }),
      );
    },
    [demo.doctorToken, demo.hospitalId],
  );

  await page.goto(`${CONSOLE}/?session=${demo.sessionId}`);
}

test.describe('S-B-05 the doctor console', () => {
  test('the doctor role opens the doctor console, not reception', async ({ page }) => {
    await openDoctorConsole(page);

    // The picker has always offered a role; until step 12 it opened reception
    // whatever was chosen, which made the doctor button a lie.
    await expect(page.getByTestId('patient-panel')).toBeVisible();
    await expect(page.getByTestId('sign-and-next')).toBeVisible();
  });

  test('opens on the patient in the chamber, with what they said beforehand', async ({ page }) => {
    await openDoctorConsole(page);

    const panel = page.getByTestId('patient-panel');
    await expect(panel).toBeVisible();

    // `FR-DOC-03`: the screen opens *with* the patient's context. The fixture's
    // booking carries no pre-visit answers, so the honest state is the one that
    // says nobody was asked — not a blank where allergies would go.
    await expect(page.getByTestId('intake-not-asked')).toBeVisible();
  });

  test('names what it cannot show rather than leaving a gap (PRD.md §3.2)', async ({ page }) => {
    await openDoctorConsole(page);

    // Test results are not part of this read. An empty area under that heading
    // would read as "this patient has none", which is not a harmless difference.
    await expect(page.getByTestId('panel-absent')).toBeVisible();
  });

  test('will not sign an empty record, and says why (FRONTEND.md §5.1)', async ({ page }) => {
    await openDoctorConsole(page);

    const sign = page.getByTestId('sign-and-next');
    await expect(sign).toBeDisabled();

    // A primary is never disabled silently: the reason is in the accessibility
    // tree, not in a tooltip a screen reader cannot reach.
    await expect(sign).toHaveAccessibleDescription(/অন্তত একটি/);
  });

  test('a diagnosis makes the record signable', async ({ page }) => {
    await openDoctorConsole(page);

    await page.getByTestId('visit-diagnosis').fill('গ্যাস্ট্রাইটিস');
    await expect(page.getByTestId('sign-and-next')).toBeEnabled();
  });
});

test.describe('signing files the record and advances the queue (FR-DOC-08)', () => {
  test('a visit written here is readable as a record afterwards', async ({ page }) => {
    await openDoctorConsole(page);
    await expect(page.getByTestId('patient-panel')).toBeVisible();

    await page.getByTestId('visit-diagnosis').fill('উচ্চ রক্তচাপ');
    await page.getByTestId('visit-advice').fill('লবণ কমান। এক মাস পর আবার দেখাবেন।');
    await page.getByTestId('sign-and-next').click();

    // `FR-DOC-08`: equivalent to reception's *done*. Serial 2 is now in the
    // chamber, and the note has been cleared for them — a new patient is a new
    // note, and a diagnosis left on screen would be the previous person's.
    await expect(page.getByTestId('patient-panel')).toContainText(bengali(2));
    await expect(page.getByTestId('visit-diagnosis')).toHaveValue('');

    // And the record exists for the *first* patient: the panel for serial 2
    // belongs to somebody else, so this reads it back through the API the
    // wallet will use at step 13.
    const records = await page.request.get(
      `http://localhost:4000/api/v1/patients/${await patientOfSerial(page, 1)}/records`,
      { headers: { authorization: `Bearer ${demo.doctorToken}` } },
    );

    expect(records.ok()).toBe(true);
    const body = (await records.json()) as {
      data: { visits: { diagnosisText: string | null; signedAt: string | null }[] };
    };

    const written = body.data.visits.find((visit) => visit.diagnosisText === 'উচ্চ রক্তচাপ');
    expect(written).toBeDefined();

    // Signed, not a draft. A draft is a doctor's unfinished thought and the
    // wallet must not show one as a conclusion.
    expect(written?.signedAt).not.toBeNull();
  });

  test('a draft saves without ending the consultation (BTN-B05-DRAFT)', async ({ page }) => {
    await openDoctorConsole(page);
    await expect(page.getByTestId('patient-panel')).toBeVisible();

    await page.getByTestId('visit-diagnosis').fill('পরীক্ষা বাকি');
    await page.getByTestId('save-draft').click();

    // Still serial 1: a draft is a note, not a decision.
    await expect(page.getByTestId('patient-panel')).toContainText(bengali(1));
    await expect(page.getByTestId('visit-diagnosis')).toHaveValue('পরীক্ষা বাকি');
  });
});

test.describe('prescribing (FR-DOC-04, FR-DOC-05, FR-DOC-07; plan R2)', () => {
  test('suggests from the formulary, holds a wrong schedule, signs, and prints what was signed', async ({
    page,
  }) => {
    // The browser's print dialog is not something a test can press; what is
    // proven is that it was asked for, with the sheet on the page.
    await page.addInitScript(() => {
      (globalThis as unknown as { printed: number }).printed = 0;
      globalThis.print = () => {
        (globalThis as unknown as { printed: number }).printed += 1;
      };
    });
    await openDoctorConsole(page);
    await expect(page.getByTestId('patient-panel')).toBeVisible();

    await page.getByTestId('visit-diagnosis').fill('শ্বাসনালীর সংক্রমণ');
    await page.getByTestId('rx-add').click();

    // FR-DOC-05: typing a name offers the formulary's entries.
    const name = page.getByTestId('rx-name-0');
    await name.pressSequentially('Para');
    await expect(page.locator('datalist option[value="Paracetamol (Napa)"]')).toBeAttached();
    await name.fill('Paracetamol (Napa)');
    await page.getByTestId('rx-strength-0').fill('500 mg');

    // A schedule the notation does not allow is said under its field, and
    // holds the signature until it is corrected.
    await page.getByTestId('rx-schedule-0').fill('twice');
    await expect(page.getByText('সকাল+দুপুর+রাত লিখুন, যেমন ১+০+১।')).toBeVisible();
    await expect(page.getByTestId('sign-and-next')).toBeDisabled();

    await page.getByTestId('rx-schedule-0').fill('১+১+১');
    await page.getByTestId('rx-days-0').fill('3');
    await page.getByTestId('rx-instruction-0').fill('খাবারের পরে');
    await expect(page.getByTestId('sign-and-next')).toBeEnabled();
    await page.getByTestId('sign-and-next').click();
    await expect(page.getByTestId('patient-panel')).toContainText(bengali(2));

    // The record carries the medicine as written, tied to the formulary.
    const records = await page.request.get(
      `http://localhost:4000/api/v1/patients/${await patientOfSerial(page, 1)}/records`,
      { headers: { authorization: `Bearer ${demo.doctorToken}` } },
    );
    const body = (await records.json()) as {
      data: {
        visits: {
          diagnosisText: string | null;
          medicines: {
            medicineId: string | null;
            name: string;
            schedule: string | null;
            durationDays: number | null;
          }[];
        }[];
      };
    };
    const written = body.data.visits.find(
      (visit) => visit.diagnosisText === 'শ্বাসনালীর সংক্রমণ',
    );
    expect(written?.medicines).toHaveLength(1);
    expect(written?.medicines[0]).toMatchObject({
      name: 'Paracetamol (Napa)',
      schedule: '1+1+1',
      durationDays: 3,
    });
    expect(written?.medicines[0]?.medicineId).not.toBeNull();

    // FR-DOC-07: the visit just signed is offered for printing, in Bangla.
    await page.getByTestId('print-last').click();
    const sheet = page.getByTestId('prescription-sheet');
    await expect(sheet).toBeAttached();
    await expect(sheet).toContainText('Paracetamol (Napa)');
    await expect(sheet).toContainText('500 mg · ১+১+১ · ৩ দিন');
    await expect(sheet).toContainText('বিএমডিসি নং');
    expect(await page.evaluate(() => (globalThis as unknown as { printed: number }).printed)).toBe(
      1,
    );
  });
});

/** The patient holding a serial, read from the queue the console is on. */
async function patientOfSerial(page: Page, serial: number): Promise<string> {
  const response = await page.request.get(
    `http://localhost:4000/api/v1/sessions/${demo.sessionId}/queue`,
    { headers: { authorization: `Bearer ${demo.doctorToken}` } },
  );

  const body = (await response.json()) as {
    data: { state: { entries: { serial: number; patientId: string }[] } };
  };

  const entry = body.data.state.entries.find((candidate) => candidate.serial === serial);
  if (entry === undefined) throw new Error(`No serial ${String(serial)} in this chamber.`);

  return entry.patientId;
}
