/**
 * `e2e/lab-report.spec.ts` — the lab and the pharmacy (step 17).
 *
 * The step's definition of done is one sentence: **a report a lab uploads
 * reaches the patient's phone.** That is the first test here, driven through
 * three screens in one run — a doctor ticks a chip and signs, a bench works
 * the order and uploads the file, and the patient opens the report from the
 * tracking link the booking left on their device.
 *
 * ## Why this needs a browser
 *
 * Every piece has unit and API tests. What only a browser shows is the chain
 * holding together across three consoles and a phone: the chip a doctor ticks
 * becomes a row on a bench somebody else is looking at, and the file that
 * bench chooses becomes a document in a wallet that belonged to nobody in
 * this story until the moment it arrived. `FR-LAB-03` is a promise about that
 * whole path, not about any one endpoint on it.
 *
 * ## What the pharmacy half proves
 *
 * `FR-PHR-02`'s honesty: a counter flags a medicine out of stock and the
 * public search says *নেই* — not silently, not by omitting the pharmacy, and
 * with the freshness of the claim beside it.
 */

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';

import { DEMO_ASSESSMENTS } from '../database/seeds/data/reference.js';

import {
  bookingBySerial,
  createConsoleSession,
  signVisit,
  type ConsoleSession,
} from './support/console.js';
import { E2E_DATABASE_URL } from './support/database.js';
import {
  labSession,
  ordersForBooking,
  publishedAnswer,
  stockedMedicine,
  type LabSession,
} from './support/lab.js';
import { reviewWorkspace } from './support/workspaceReview.js';

const PATIENT = 'http://localhost:3000';
const CONSOLE = 'http://localhost:3100';

/** The guest each test books, as the doctor's panel names them. */
const GUEST_NAME = 'রহিমা খাতুন';

/** From the seed's declared set, so the spec invents no clinical content. */
const ASSESSMENT = DEMO_ASSESSMENTS[0];

let demo: ConsoleSession;
let lab: LabSession;

test.beforeEach(async () => {
  // One seeded patient in the chamber; the guest this spec books is serial 2.
  demo = await createConsoleSession(1);
  lab = await labSession(demo.hospitalId);
});

/** A phone nobody else in the run will use (`DB-P6` normalised). */
function guestPhone(): string {
  const tail = String(Math.floor(Math.random() * 90_000_000) + 10_000_000);
  return `+88019${tail}`;
}

/** Books serial 2 as a guest, leaving the link on this device. */
async function bookAsGuest(page: Page): Promise<string> {
  await page.goto(`${PATIENT}/book?specialty=${demo.departmentCode}`);

  await page.getByTestId(`hospital-${demo.hospitalId}`).click();
  await page.getByTestId(`doctor-${demo.doctorId}`).click();
  await page.getByTestId(`session-${demo.sessionId}`).click();

  await page.getByLabel('রোগীর নাম').fill(GUEST_NAME);
  await page.getByLabel('মোবাইল নম্বর').fill(guestPhone());
  await page.getByLabel('বয়স').fill('34');
  await page.getByTestId('confirm-booking').click();

  await expect(page.getByTestId('booking-success')).toBeVisible();

  const booking = await bookingBySerial(demo.sessionId, 2);
  if (booking === null) throw new Error('the guest booking was not written');
  return booking.id;
}

/**
 * Finishes serial 1, which calls the guest into the chamber.
 *
 * Through the API, as `wallet.spec.ts` does: `BTN-B05-SIGN` needs something
 * written before it will sign, and typing a second record here would be
 * testing the doctor console twice rather than the lab once.
 */
async function callInTheGuest(): Promise<void> {
  if (ASSESSMENT === undefined) throw new Error('the seed declares no assessments');
  const first = demo.bookingsBySerial.get(1);
  if (first === undefined) throw new Error('no serial 1');

  await signVisit(demo, first, {
    diagnosisText: ASSESSMENT.diagnosisBn,
    adviceTextBn: ASSESSMENT.adviceBn,
  });
}

/** Enters a console as the picker would, with no password (`CLAUDE.md` §4.1). */
async function enterConsole(page: Page, token: string, role: string, url: string): Promise<void> {
  await page.addInitScript(
    ([t, hospitalId, r]) => {
      sessionStorage.setItem(
        'console.demo-session',
        JSON.stringify({ token: t, hospitalId, staffName: 'Demo', role: r }),
      );
    },
    [token, demo.hospitalId, role],
  );
  await page.goto(url);
}

test.describe('a report a lab uploads reaches the patient (FR-LAB-03)', () => {
  test('doctor ticks a test, bench reports it, wallet opens it', async ({ page, context }) => {
    // One journey across three apps: the patient books, the doctor's screen
    // and the lab bench each open in a console, the patient reads the wallet.
    // Each console's first visit compiles its page on a dev server, and on a
    // machine short of memory the whole walk took from fifty seconds to two
    // minutes on the same commit (7 October). Like the other walks across
    // apps in this suite, it is given two minutes.
    test.setTimeout(120_000);
    if (ASSESSMENT === undefined) throw new Error('the seed declares no assessments');

    // --- the patient books, and this device keeps the link -----------------
    const bookingId = await bookAsGuest(page);

    // --- the doctor calls them in, ticks a test, and signs ------------------
    // Serial 1 is finished through the API rather than typed: this spec is
    // about the test chips, and signing needs content either way. Finished
    // before the doctor's screen opens: a screen that has already loaded
    // serial 1 keeps it after it is signed elsewhere (FR-DOC-08), so opening
    // first made the guest's arrival a race between the page and the API.
    await callInTheGuest();
    const doctor = await context.newPage();
    await enterConsole(doctor, demo.doctorToken, 'doctor', `${CONSOLE}/?session=${demo.sessionId}`);
    await expect(doctor.getByTestId('doctor-patient-identity')).toContainText(GUEST_NAME);
    await expect(doctor.getByTestId('visit-diagnosis')).toHaveValue('');

    await doctor.getByTestId('visit-diagnosis').fill(ASSESSMENT.diagnosisBn);

    // `BTN-B05-TEST`: the chips are the hospital's own catalogue.
    const tests = doctor.getByTestId('visit-tests');
    await expect(tests).toBeVisible();
    await tests.getByRole('button').first().click();

    await doctor.getByTestId('sign-and-next').click();
    await doctor.getByTestId('doctor-confirm-sign').click();

    // `APP_FLOW.md` B2: ticked on save, so the order exists now and not before.
    await expect
      .poll(async () => (await ordersForBooking(bookingId)).length, { timeout: 10_000 })
      .toBe(1);

    const [ordered] = await ordersForBooking(bookingId);
    expect(ordered?.state).toBe('ordered');

    // --- the bench sees it, works it, and uploads the report ----------------
    const bench = await context.newPage();
    await enterConsole(bench, lab.labToken, 'lab', `${CONSOLE}/?view=lab`);

    const row = bench.getByTestId(`lab-order-${ordered?.id ?? ''}`);
    await expect(row).toBeVisible();

    // The patient's name is not on the row until somebody asks (`DB-P7`).
    await expect(bench.getByTestId(`lab-reveal-${ordered?.id ?? ''}`)).toBeVisible();

    await bench.getByTestId(`lab-collect-${ordered?.id ?? ''}`).click();
    await bench.getByTestId(`lab-process-${ordered?.id ?? ''}`).click();

    await expect
      .poll(async () => (await ordersForBooking(bookingId))[0]?.state, { timeout: 10_000 })
      .toBe('processing');

    // The upload is a real file through the real input.
    await bench.getByTestId(`lab-upload-${ordered?.id ?? ''}`).click();
    await bench.getByTestId(`lab-report-file-${ordered?.id ?? ''}`).setInputFiles({
      name: 'report.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'latin1'),
    });

    await bench.getByTestId(`lab-report-submit-${ordered?.id ?? ''}`).click();

    // Uploading *is* delivering: the order ends delivered and the report row
    // carries the stamp, in one act (`FR-LAB-03`).
    await expect
      .poll(async () => (await ordersForBooking(bookingId))[0]?.state, { timeout: 15_000 })
      .toBe('delivered');

    const [delivered] = await ordersForBooking(bookingId);
    expect(delivered?.reportDeliveredAt).not.toBeNull();

    // --- the patient opens it from the link this phone already held ---------
    await page.goto(`${PATIENT}/records`);

    // `TAB-A12-REP` appears because there is something in it.
    await page.getByTestId('wallet-tab-reports').click();

    const reports = page.getByTestId('report-list');
    await expect(reports).toBeVisible();
    await expect(reports).toContainText(ordered?.testCode ?? '');

    const open = page.getByTestId(`report-open-${delivered?.id ?? ''}`);
    await expect(open).toBeVisible();

    // Tapping mints a fresh signed URL and opens it. The new tab is what the
    // patient gets, and it has to be the file rather than a 404.
    // A headless browser takes a PDF tab as a download, so the request the tab
    // makes is what is caught, and the file is fetched again to prove it.
    const [requested] = await Promise.all([
      context.waitForEvent('request', (request) => request.url().includes('/files/')),
      open.click(),
    ]);
    // On the API, where the file is served: opened as it came, it was the
    // patient app's own address and a page that does not exist (plan R3).
    expect(requested.url()).toContain('/api/v1/files/');
    const file = await page.request.get(requested.url());
    expect(file.status()).toBe(200);
    expect(file.headers()['content-type']).toContain('application/pdf');
  });

  test('a test still on the bench says so, rather than saying no reports', async ({
    page,
    context,
  }) => {
    if (ASSESSMENT === undefined) throw new Error('the seed declares no assessments');

    const bookingId = await bookAsGuest(page);

    // Serial 1 is finished before the doctor's screen opens (see the case above).
    await callInTheGuest();
    const doctor = await context.newPage();
    await enterConsole(doctor, demo.doctorToken, 'doctor', `${CONSOLE}/?session=${demo.sessionId}`);
    await expect(doctor.getByTestId('doctor-patient-identity')).toContainText(GUEST_NAME);
    await doctor.getByTestId('visit-diagnosis').fill(ASSESSMENT.diagnosisBn);
    await doctor.getByTestId('visit-tests').getByRole('button').first().click();
    await doctor.getByTestId('sign-and-next').click();
    await doctor.getByTestId('doctor-confirm-sign').click();

    await expect
      .poll(async () => (await ordersForBooking(bookingId)).length, { timeout: 10_000 })
      .toBe(1);

    await page.goto(`${PATIENT}/records`);
    await page.getByTestId('wallet-tab-reports').click();

    // "We are testing it" is a different sentence from "you have no reports",
    // and it is the one that stops somebody ringing the hospital.
    const reports = page.getByTestId('report-list');
    await expect(reports).toBeVisible();
    await expect(reports).toContainText('নমুনা দেওয়া বাকি');
    await expect(page.getByTestId('reports-empty')).toHaveCount(0);
  });

  test('a patient with no test is shown no Reports tab at all', async ({ page }) => {
    await bookAsGuest(page);
    await page.goto(`${PATIENT}/records`);

    // An empty Reports tab is a claim about the patient's health (`PRD.md`
    // §3.2). The tab is absent rather than empty.
    await expect(page.getByTestId('wallet-tabs')).toHaveCount(0);
  });
});

test.describe('the bench queue (S-B-08, FR-LAB-01, FR-LAB-04)', () => {
  test('opens on work rather than on nothing, with turnaround beside it', async ({ page }) => {
    await enterConsole(page, lab.labToken, 'lab', `${CONSOLE}/?view=lab`);

    // `CLAUDE.md` §5.3: no feature ships with an empty screen, and the seed
    // guarantees every lab has open orders.
    await expect(page.getByTestId('lab-console')).toBeVisible();
    await expect(page.locator('[data-testid^="lab-order-"]').first()).toBeVisible();
    await expect(page.getByTestId('lab-empty')).toHaveCount(0);

    // `FR-LAB-04`, measured and visible.
    await expect(page.getByTestId('lab-turnaround')).toBeVisible();
  });
});

test.describe('the pharmacy shelf is what the public is told (FR-PHR-02)', () => {
  test('flagging a medicine out of stock reaches the patient search', async ({ page, context }) => {
    const medicine = await stockedMedicine(demo.hospitalId);

    await enterConsole(page, lab.pharmacyToken, 'pharmacy', `${CONSOLE}/?view=pharmacy`);
    await expect(page.getByTestId('pharmacy-console')).toBeVisible();

    // `FR-PHR-01` is absent and says why, rather than a dead scanner.
    await expect(page.getByTestId('pharmacy-dispense-absent')).toBeVisible();

    const row = page.getByTestId(`stock-${medicine.medicineId}`);
    await expect(row).toBeVisible();
    await page.getByTestId(`stock-out-${medicine.medicineId}`).click();

    await expect
      .poll(
        async () =>
          await publishedAnswer(medicine.medicineId, demo.hospitalId, medicine.genericName),
        { timeout: 10_000 },
      )
      .toBe('out_of_stock');

    // And the patient's screen says নেই, with the age of the claim beside it.
    const patient = await context.newPage();
    await patient.goto(`${PATIENT}/medicines`);
    await patient.getByTestId('medicine-search').fill(medicine.genericName);

    const card = patient.getByTestId(`medicine-${medicine.medicineId}`);
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText('নেই');

    // `GR-05`: counts, never a verdict about the whole city.
    await expect(patient.getByTestId('medicine-summary').first()).toBeVisible();
  });

  test('confirming an unchanged list renews what the public is told', async ({ page }) => {
    await enterConsole(page, lab.pharmacyToken, 'pharmacy', `${CONSOLE}/?view=pharmacy`);

    // The commonest and most valuable thing done at this counter: nothing
    // changed, and saying so is what keeps the flags standing (`FR-PHR-02`).
    await page.getByTestId('pharmacy-confirm-all').click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /পুরো তালিকা ঠিক আছে/ })
      .click();
    await expect(page.getByTestId('pharmacy-console')).toBeVisible();
    await expect(page.getByTestId('pharmacy-failed')).toHaveCount(0);
  });
});

interface ShelfRow {
  medicineId: string;
  inStock: boolean;
  updatedAt: string;
  genericName: string;
}
test.describe('redesigned lab and pharmacy safeguards', () => {
  test('whole-list review confirms hidden source rows with their exact versions', async ({
    page,
  }) => {
    await enterConsole(page, lab.pharmacyToken, 'pharmacy', `${CONSOLE}/?view=pharmacy`);
    await expect(page.getByTestId('pharmacy-confirm-all')).toBeEnabled();
    const response = await page.request.get(
      `http://localhost:4000/api/v1/hospitals/${demo.hospitalId}/pharmacy-stock`,
      { headers: { Authorization: `Bearer ${lab.pharmacyToken}` } },
    );
    const source = ((await response.json()) as { data: { rows: ShelfRow[] } }).data.rows;
    expect(source.length).toBeGreaterThan(1);
    await page.getByTestId('pharmacy-search').fill(source[0]!.genericName);
    expect(await page.locator('.pharmacy-list > li').count()).toBeLessThan(source.length);
    await page.getByTestId('pharmacy-confirm-all').click();
    const request = page.waitForRequest(
      (entry) => entry.method() === 'PUT' && entry.url().endsWith('/pharmacy-stock'),
    );
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /পুরো তালিকা ঠিক আছে|The whole list is correct/ })
      .click();
    const flags = (await request).postDataJSON() as {
      flags: { medicineId: string; inStock: boolean; expectedUpdatedAt: string }[];
    };
    expect(flags.flags).toHaveLength(source.length);
    for (const row of source)
      expect(flags.flags).toContainEqual({
        medicineId: row.medicineId,
        inStock: row.inStock,
        expectedUpdatedAt: row.updatedAt,
      });
    await expect(page.getByTestId('pharmacy-confirm-all')).toBeEnabled();
  });

  test('a stale staff tab reloads instead of overwriting another stock decision', async ({
    page,
  }) => {
    await enterConsole(page, lab.pharmacyToken, 'pharmacy', `${CONSOLE}/?view=pharmacy`);
    await expect(page.getByTestId('pharmacy-confirm-all')).toBeEnabled();
    const url = `http://localhost:4000/api/v1/hospitals/${demo.hospitalId}/pharmacy-stock`;
    const response = await page.request.get(url, {
      headers: { Authorization: `Bearer ${lab.pharmacyToken}` },
    });
    const source = ((await response.json()) as { data: { rows: ShelfRow[] } }).data.rows;
    const row = source[0]!;
    const key = crypto.randomUUID();
    const changed = await page.request.put(url, {
      headers: { Authorization: `Bearer ${lab.pharmacyToken}`, 'Idempotency-Key': key },
      data: {
        flags: [
          { medicineId: row.medicineId, inStock: !row.inStock, expectedUpdatedAt: row.updatedAt },
        ],
        idempotencyKey: key,
      },
    });
    expect(changed.status()).toBe(200);
    const refusal = page.waitForResponse(
      (entry) => entry.request().method() === 'PUT' && entry.url() === url,
    );
    await page.getByTestId(`stock-${row.inStock ? 'in' : 'out'}-${row.medicineId}`).click();
    expect((await refusal).status()).toBe(409);
    await expect(page.getByTestId(`stock-${row.medicineId}`)).toHaveAttribute(
      'data-answer',
      row.inStock ? 'out_of_stock' : 'in_stock',
    );
    const after = await page.request.get(url, {
      headers: { Authorization: `Bearer ${lab.pharmacyToken}` },
    });
    expect(
      ((await after.json()) as { data: { rows: ShelfRow[] } }).data.rows.find(
        (entry) => entry.medicineId === row.medicineId,
      )?.inStock,
    ).toBe(!row.inStock);
  });

  test('upload review keeps the selected file and upload key through Help and rejection', async ({
    page,
  }) => {
    await enterConsole(page, lab.labToken, 'lab', `${CONSOLE}/?view=lab`);
    await expect(page.getByTestId('lab-console')).toBeVisible();
    const response = await page.request.get(
      `http://localhost:4000/api/v1/hospitals/${demo.hospitalId}/test-orders?state=open&days=30`,
      { headers: { Authorization: `Bearer ${lab.labToken}` } },
    );
    const orders = (
      (await response.json()) as {
        data: { orders: { id: string; state: string; report: unknown }[] };
      }
    ).data.orders;
    const order = orders.find((entry) => entry.state === 'processing' && entry.report === null);
    expect(order).toBeDefined();
    const id = order!.id;
    await page.addInitScript((orderId) => {
      const nativeFetch = globalThis.fetch.bind(globalThis);
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          typeof input === 'string' ? input : input.url,
          globalThis.location.href,
        );
        if (init?.method !== 'POST' || !url.pathname.endsWith(`/test-orders/${orderId}/report`))
          return await nativeFetch(input, init);

        const attempts = Number(sessionStorage.getItem('lab-report-attempts') ?? '0');
        sessionStorage.setItem('lab-report-attempts', String(attempts + 1));
        const keys = JSON.parse(sessionStorage.getItem('lab-report-keys') ?? '[]') as string[];
        keys.push(new Headers(init.headers).get('idempotency-key') ?? '');
        sessionStorage.setItem('lab-report-keys', JSON.stringify(keys));
        if (attempts === 0)
          return new Response(
            JSON.stringify({
              ok: false,
              error: { code: 'REPORT_STORAGE_FAILED', message: 'Synthetic rejection' },
            }),
            { status: 503, headers: { 'content-type': 'application/json' } },
          );
        return await nativeFetch(input, init);
      };
    }, id);
    await page.reload();
    await expect(page.getByTestId('lab-console')).toBeVisible();
    await page.getByTestId(`lab-upload-${id}`).click();
    await page.getByTestId(`lab-report-file-${id}`).setInputFiles({
      name: 'synthetic-report.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%%EOF\n'),
    });
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /সাহায্য|Help/ })
      .click();
    await expect(page.locator('[data-help-topic="lab-upload"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toContainText('synthetic-report.pdf');
    await page.getByTestId(`lab-report-submit-${id}`).click();
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('lab-report-attempts')))
      .toBe('1');
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('synthetic-report.pdf');
    await page.getByTestId(`lab-report-submit-${id}`).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const keys = await page.evaluate(
      () => JSON.parse(sessionStorage.getItem('lab-report-keys') ?? '[]') as string[],
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe('');
    expect(keys[1]).toBe(keys[0]);
  });

  /**
   * FR-LAB-03: a reply lost after the upload left. A report on the order is
   * not proof it is the bench's own file — only the same key can say — so the
   * console replays the same attempt and believes the server's answer to it.
   */
  /**
   * An order on the bench with no report yet, made for this case alone: the
   * doctor signs serial 1's visit and orders a test, the bench collects and
   * processes it. The seed holds one such order, and two cases that each
   * took "the first" left the second with none (18 October).
   */
  async function processingOrderWithoutReport(page: Page): Promise<string> {
    const booking = await bookingBySerial(demo.sessionId, 1);
    expect(booking).not.toBeNull();
    await signVisit(demo, booking!.id, {
      diagnosisText: ASSESSMENT!.diagnosisBn,
      adviceTextBn: ASSESSMENT!.adviceBn,
    });
    const orderKey = crypto.randomUUID();
    const ordered = await page.request.post('http://localhost:4000/api/v1/test-orders', {
      headers: { Authorization: `Bearer ${demo.doctorToken}`, 'Idempotency-Key': orderKey },
      data: { bookingId: booking!.id, tests: [{ testCode: 'CBC' }], idempotencyKey: orderKey },
    });
    expect(ordered.ok()).toBe(true);
    const [order] = await ordersForBooking(booking!.id);
    expect(order).toBeDefined();
    for (const action of ['collect', 'process'] as const) {
      const stepKey = crypto.randomUUID();
      const stepped = await page.request.patch(
        `http://localhost:4000/api/v1/test-orders/${order!.id}/state`,
        {
          headers: { Authorization: `Bearer ${lab.labToken}`, 'Idempotency-Key': stepKey },
          data: { action, idempotencyKey: stepKey },
        },
      );
      expect(stepped.ok()).toBe(true);
    }
    expect((await ordersForBooking(booking!.id))[0]?.state).toBe('processing');
    return order!.id;
  }

  async function reportKeys(orderId: string): Promise<string[]> {
    const client = new Client({ connectionString: E2E_DATABASE_URL });
    await client.connect();
    try {
      const rows = await client.query<{ idempotency_key: string }>(
        'SELECT idempotency_key FROM reports WHERE test_order_id = $1',
        [orderId],
      );
      return rows.rows.map((row) => row.idempotency_key);
    } finally {
      await client.end();
    }
  }

  test('a lost reply to a committed upload is confirmed by replaying the same attempt', async ({
    page,
  }) => {
    await enterConsole(page, lab.labToken, 'lab', `${CONSOLE}/?view=lab`);
    const id = await processingOrderWithoutReport(page);
    await page.addInitScript((orderId) => {
      const nativeFetch = globalThis.fetch.bind(globalThis);
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          typeof input === 'string' ? input : input.url,
          globalThis.location.href,
        );
        if (init?.method !== 'POST' || !url.pathname.endsWith(`/test-orders/${orderId}/report`))
          return await nativeFetch(input, init);
        const keys = JSON.parse(sessionStorage.getItem('lab-report-keys') ?? '[]') as string[];
        keys.push(new Headers(init.headers).get('idempotency-key') ?? '');
        sessionStorage.setItem('lab-report-keys', JSON.stringify(keys));
        const response = await nativeFetch(input, init);
        // The first upload commits; its answer never arrives.
        if (keys.length === 1) throw new TypeError('Synthetic lost reply');
        return response;
      };
    }, id);
    await page.reload();
    await expect(page.getByTestId('lab-console')).toBeVisible();
    await page.getByTestId(`lab-upload-${id}`).click();
    await page.getByTestId(`lab-report-file-${id}`).setInputFiles({
      name: 'report-A.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n% synthetic report A\n%%EOF\n'),
    });
    await page.getByTestId(`lab-report-submit-${id}`).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const keys = await page.evaluate(
      () => JSON.parse(sessionStorage.getItem('lab-report-keys') ?? '[]') as string[],
    );
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(await reportKeys(id)).toEqual([keys[0]]);
  });

  test('a lost reply is not confirmed by a different report on the same order', async ({
    page,
  }) => {
    await enterConsole(page, lab.labToken, 'lab', `${CONSOLE}/?view=lab`);
    const id = await processingOrderWithoutReport(page);
    const otherKey = crypto.randomUUID();
    const otherContent = Buffer.from('%PDF-1.4\n% synthetic report B\n%%EOF\n').toString('base64');
    await page.addInitScript(
      ({ orderId, otherKey, otherContent }) => {
        const nativeFetch = globalThis.fetch.bind(globalThis);
        globalThis.fetch = async (input, init) => {
          const url = new URL(
            typeof input === 'string' ? input : input.url,
            globalThis.location.href,
          );
          if (init?.method !== 'POST' || !url.pathname.endsWith(`/test-orders/${orderId}/report`))
            return await nativeFetch(input, init);
          if (sessionStorage.getItem('lab-report-competed') !== null)
            return await nativeFetch(input, init);
          // Another bench's file B lands first; this bench's A is lost on the way.
          const original = JSON.parse(init.body as string) as Record<string, unknown>;
          const headers = new Headers(init.headers);
          headers.set('Idempotency-Key', otherKey);
          const competing = await nativeFetch(input, {
            ...init,
            headers,
            // Another bench's attempt: its own event and key, as its console makes them.
            body: JSON.stringify({
              ...original,
              content: otherContent,
              clientEventId: otherKey,
              idempotencyKey: otherKey,
            }),
          });
          sessionStorage.setItem('lab-report-competed', String(competing.status));
          throw new TypeError('Synthetic lost upload A');
        };
      },
      { orderId: id, otherKey, otherContent },
    );
    await page.reload();
    await expect(page.getByTestId('lab-console')).toBeVisible();
    await page.getByTestId(`lab-upload-${id}`).click();
    await page.getByTestId(`lab-report-file-${id}`).setInputFiles({
      name: 'report-A.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n% synthetic report A\n%%EOF\n'),
    });
    await page.getByTestId(`lab-report-submit-${id}`).click();

    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('lab-report-competed')))
      .toBe('201');
    // The toast itself, not the screen-reader copy Radix announces it with.
    await expect(
      page
        .locator('li[data-state="open"]')
        .filter({ hasText: /অন্য একটি রিপোর্ট|A different report/ }),
    ).toBeVisible();
    // Never told its own file was delivered.
    await expect(page.getByText(/^পৌঁছেছে: রোগী|^Delivered to: patient/)).toHaveCount(0);
    expect(await reportKeys(id)).toEqual([otherKey]);
  });

  test('representative bilingual tablet workspaces remain usable offline', async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    const directory = resolve('docs/design/console-lab-pharmacy/screenshots');
    await mkdir(directory, { recursive: true });
    for (const [role, token] of [
      ['lab', lab.labToken],
      ['pharmacy', lab.pharmacyToken],
    ] as const) {
      await enterConsole(page, token, role, `${CONSOLE}/?view=${role}`);
      await expect(page.getByTestId(`${role}-console`)).toBeVisible();
      await expect(page.getByTestId(`${role}-loading`)).toHaveCount(0);
      await expect(page.getByTestId(`${role}-failed`)).toHaveCount(0);
      await page.getByTestId('language-bn').click();
      await reviewWorkspace(page, resolve(directory, `${role}-bn-tablet.png`));
      await page.getByTestId('language-en').click();
      await reviewWorkspace(page, resolve(directory, `${role}-en-tablet.png`));
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth),
      ).toBe(true);
      await context.setOffline(true);
      if (role === 'pharmacy')
        await expect(page.getByTestId('pharmacy-confirm-all')).toBeDisabled();
      else await expect(page.locator('[data-testid^="lab-collect-"]').first()).toBeDisabled();
      await context.setOffline(false);
    }
  });
});
