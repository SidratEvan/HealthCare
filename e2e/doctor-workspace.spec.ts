/** Real Doctor UI, server receipts and visual review (FR-DOC-03/07/08/10, GR-06). */
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { signToken } from '../backend/api/src/config/jwt.js';
import { bnCalendarDate } from '../shared/i18n/src/prescription.js';

import { createConsoleSession, type ConsoleSession } from './support/console.js';
import { openDoctor, signAndNext } from './support/doctor.js';
import { registrationDatabase } from './support/registration.js';

const API = 'http://localhost:4000/api/v1';
const directory = resolve('docs/design/console-doctor');
async function shot(page: Page, name: string, fullPage = false) {
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(directory, `${name}.png`), fullPage });
}
async function stored(fixture: ConsoleSession) {
  return await registrationDatabase(
    async (client) =>
      (
        await client.query<{
          diagnosis_text: string;
          follow_up_date: string | null;
          signed_at: Date | null;
        }>(
          'SELECT diagnosis_text, follow_up_date::text, signed_at FROM visits WHERE booking_id=$1',
          [fixture.bookingsBySerial.get(1)],
        )
      ).rows[0],
  );
}
async function axe(page: Page) {
  const source = await readFile(resolve('node_modules/axe-core/axe.min.js'), 'utf8');
  await page.evaluate((code) => {
    const script = document.createElement('script');
    script.nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce ?? '';
    script.textContent = code;
    document.head.appendChild(script);
  }, source);
  const errors = await page.evaluate(async () =>
    (
      await (
        window as unknown as {
          axe: { run: (root: Document) => Promise<{ violations: { id: string }[] }> };
        }
      ).axe.run(document)
    ).violations.map((v) => v.id),
  );
  expect(errors).toEqual([]);
}
async function custom(page: Page, value: string) {
  await page.getByTestId('follow-up-custom').click();
  await page.getByTestId('follow-up-days').fill(value);
}
async function saveDraft(page: Page) {
  const receipt = page.waitForResponse(
    (response) => response.url() === `${API}/visits` && response.request().method() === 'POST',
  );
  await page.getByTestId('save-draft').click();
  expect((await receipt).ok()).toBe(true);
}

for (const locale of ['bn', 'en'] as const)
  test(`approved workspace, Help, queue and sign review at desktop/tablet sizes in ${locale}`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (/same key|hydration/i.test(message.text())) errors.push(message.text());
    });
    const fixture = await openDoctor(page, await createConsoleSession(6));
    await page.getByTestId(`language-${locale}`).click();
    await expect(page.getByTestId('doctor-patient-identity').locator('h1')).toContainText(
      /ডেমো|Demo/,
    );
    await expect(page.getByTestId('intake-not-asked')).toBeVisible();
    await expect(page.getByTestId('doctor-save-status')).toContainText(
      locale === 'bn' ? 'সার্ভারে রাখা হয়নি' : 'Not saved',
    );
    for (const [width, height, name] of [
      [1440, 900, 'desktop'],
      [1024, 768, 'landscape'],
      [768, 1024, 'portrait'],
    ] as const) {
      await page.setViewportSize({ width, height });
      await shot(page, `empty-${name}-${locale}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const geometry = await page.evaluate(() => ({
        headerBottom:
          document.querySelector('.doctor-workspace .cf-header')?.getBoundingClientRect().bottom ??
          0,
        sessionTop: document.querySelector('.doc-session-wrap')?.getBoundingClientRect().top ?? 0,
        sessionBottom:
          document.querySelector('.doc-session-wrap')?.getBoundingClientRect().bottom ?? 0,
        patientTop: document.querySelector('.doc-identity')?.getBoundingClientRect().top ?? 0,
        pageHeight: document.documentElement.scrollHeight,
        viewportHeight: innerHeight,
      }));
      expect(geometry.sessionTop).toBeGreaterThanOrEqual(geometry.headerBottom);
      expect(geometry.patientTop).toBeGreaterThanOrEqual(geometry.sessionBottom);
      expect(geometry.pageHeight, JSON.stringify(geometry)).toBeLessThanOrEqual(
        geometry.viewportHeight + 2,
      );
      await expect(page.getByTestId('save-draft')).toBeInViewport();
      await expect(page.getByTestId('sign-and-next')).toBeInViewport();
      if (width < 1280) {
        await page.getByTestId('doctor-queue-toggle').click();
        await expect(page.getByRole('dialog')).toContainText(
          locale === 'bn' ? 'রিসেপশন' : 'Reception',
        );
        await shot(page, `queue-${name}-${locale}`);
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('doctor-queue-toggle')).toBeFocused();
      }
    }
    await page.getByTestId('visit-diagnosis').fill('Doctor record review (Demo)');
    await page.getByTestId('visit-advice').fill('Synthetic advice for interface verification');
    await custom(page, '৫');
    await expect(page.getByTestId('follow-up-date')).toBeVisible();
    await page.getByTestId('follow-up-days').focus();
    await page.getByRole('button', { name: /সাহায্য|Help/ }).click();
    await expect(page.locator('[data-help-topic="doctor-followup"]')).toBeVisible();
    await shot(page, `help-${locale}`);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('follow-up-days')).toHaveValue('৫');
    await expect(page.getByTestId('visit-diagnosis')).toHaveValue('Doctor record review (Demo)');
    await page.getByTestId('save-draft').click();
    await expect.poll(async () => (await stored(fixture))?.follow_up_date ?? null).not.toBeNull();
    await expect(page.getByTestId('doctor-save-status')).toContainText(
      locale === 'bn' ? 'খসড়া রাখা হয়েছে' : 'Draft saved',
    );
    for (const [width, height, name] of [
      [1440, 900, 'desktop'],
      [1024, 768, 'landscape'],
      [768, 1024, 'portrait'],
    ] as const) {
      await page.setViewportSize({ width, height });
      await shot(page, `record-${name}-${locale}`);
      await page.getByTestId('sign-and-next').click();
      await expect(page.getByTestId('doctor-sign-summary')).toContainText(
        'Doctor record review (Demo)',
      );
      await expect(page.getByTestId('doctor-sign-follow-up')).not.toHaveText(
        locale === 'bn' ? 'দরকার নেই' : 'Not needed',
      );
      await shot(page, `sign-${name}-${locale}`);
      await page.getByRole('button', { name: /রেকর্ডে ফিরুন|Back to record/ }).click();
      await expect(page.getByTestId('sign-and-next')).toBeFocused();
    }
    await axe(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await signAndNext(page);
    await expect.poll(async () => (await stored(fixture))?.signed_at != null).toBe(true);
    await expect(page.getByTestId('visit-diagnosis')).toHaveValue('');
    expect(errors).toEqual([]);
  });

test('all invalid custom values block signing but save other notes while clearing a previously stored date', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixture = await openDoctor(page, await createConsoleSession(4));
  await page.getByTestId('visit-diagnosis').fill('Follow-up validation (Demo)');
  await page.getByTestId('follow-up-7').click();
  await saveDraft(page);
  await expect.poll(async () => (await stored(fixture))?.follow_up_date ?? null).not.toBeNull();
  for (const raw of ['', '0', '০', '-1', '2.5', '৩৬৬']) {
    await custom(page, raw);
    await expect(page.getByTestId('follow-up-days')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('sign-and-next')).toBeDisabled();
    await saveDraft(page);
    await expect(page.getByTestId('follow-up-excluded')).toBeVisible();
    expect(await stored(fixture)).toMatchObject({
      diagnosis_text: 'Follow-up validation (Demo)',
      follow_up_date: null,
      signed_at: null,
    });
    await expect(page.getByTestId('follow-up-days')).toHaveValue(raw);
  }
  await shot(page, 'draft-without-invalid-followup');
  await custom(page, '১');
  await expect(page.getByTestId('sign-and-next')).toBeEnabled();
  await saveDraft(page);
  const first = (await stored(fixture))?.follow_up_date ?? null;
  expect(first).not.toBeNull();
  await custom(page, '365');
  await saveDraft(page);
  const last = (await stored(fixture))?.follow_up_date ?? null;
  expect(last).not.toBeNull();
  expect(last).not.toBe(first);
});

test('custom date is confirmed and printed from the signed server record', async ({ page }) => {
  const fixture = await openDoctor(page, await createConsoleSession(4));
  await page.addInitScript(() => {
    window.print = () => {
      /* Native printer is suppressed; the actual server sheet is asserted below. */
    };
  });
  await page.evaluate(() => {
    window.print = () => {
      /* Native printer is suppressed; the actual server sheet is asserted below. */
    };
  });
  await page.getByTestId('visit-diagnosis').fill('Printed follow-up (Demo)');
  await page.getByTestId('rx-add').click();
  await page.getByTestId('rx-name-0').fill('Paracetamol (Napa)');
  await page.getByTestId('rx-schedule-0').fill('1+0+1');
  await page.getByTestId('rx-days-0').fill('3');
  await custom(page, '৫');
  const dateText = await page.getByTestId('follow-up-date').textContent();
  await shot(page, 'custom-followup-field');
  await page.getByTestId('sign-and-next').click();
  await expect(page.getByTestId('doctor-sign-follow-up')).toHaveText(dateText ?? '');
  await page.getByTestId('doctor-confirm-sign').click();
  await expect.poll(async () => (await stored(fixture))?.signed_at != null).toBe(true);
  await page.getByTestId('print-last').click();
  await expect(page.getByTestId('prescription-sheet')).toBeAttached();
  await expect(page.getByTestId('prescription-sheet')).toContainText('Paracetamol (Napa)');
  const date = (await stored(fixture))?.follow_up_date;
  expect(date).not.toBeNull();
  if (date == null) throw new Error('Missing persisted follow-up');
  await expect(page.getByTestId('prescription-sheet')).toContainText(bnCalendarDate(date));
  await page.emulateMedia({ media: 'print' });
  await shot(page, 'printed-custom-followup', true);
  await page.emulateMedia({ media: 'screen' });
});

test('queue changes during sign review cannot confirm the new patient', async ({
  page,
  playwright,
}) => {
  const fixture = await openDoctor(page, await createConsoleSession(4));
  await page.getByTestId('visit-diagnosis').fill('Review queue race (Demo)');
  await page.getByTestId('sign-and-next').click();
  const key = crypto.randomUUID();
  // The external Reception actor owns a fresh HTTP agent, separate from the
  // Doctor login's idle keep-alive connection. One attempt, no transport retry.
  const reception = await playwright.request.newContext();
  try {
    const next = await reception.post(`${API}/sessions/${fixture.sessionId}/next`, {
      headers: { authorization: `Bearer ${fixture.token}`, 'idempotency-key': key },
      data: { clientEventId: key },
      maxRetries: 0,
    });
    expect(next.ok()).toBe(true);
  } finally {
    await reception.dispose();
  }
  await expect(page.getByTestId('doctor-confirm-sign')).toBeDisabled();
  await expect(page.getByTestId('doctor-sign-summary')).toContainText('Review queue race (Demo)');
  expect(await stored(fixture)).toBeUndefined();
  await page.getByRole('button', { name: /রেকর্ডে ফিরুন|Back to record/ }).click();
  await expect(page.getByTestId('visit-diagnosis')).toHaveValue('Review queue race (Demo)');
  await shot(page, 'retained-old-patient-after-review-race');
});

test('30-minute delay review does not send until confirmation', async ({ page }) => {
  const fixture = await openDoctor(page, await createConsoleSession(4));
  await page.getByTestId('visit-diagnosis').fill('Delay retains note (Demo)');
  await page.getByRole('button', { name: /দেরি ঘোষণা|Declare delay/ }).click();
  await shot(page, 'delay-confirmation');
  await page.getByTestId('doctor-confirm-delay').click();
  await expect
    .poll(
      async () =>
        await registrationDatabase(
          async (client) =>
            (
              await client.query<{ n: number }>(
                "SELECT count(*)::int AS n FROM queue_events WHERE session_id=$1 AND type='DELAY_DECLARED' AND (payload->>'minutes')::int=30",
                [fixture.sessionId],
              )
            ).rows[0]?.n,
        ),
    )
    .toBe(1);
  await expect(page.getByTestId('visit-diagnosis')).toHaveValue('Delay retains note (Demo)');
});

test('an excluded invalid follow-up still requires explicit discard after reception changes patient', async ({
  page,
}) => {
  const fixture = await openDoctor(page, await createConsoleSession(4));
  await page.getByTestId('visit-diagnosis').fill('Excluded follow-up guard (Demo)');
  await custom(page, '0');
  await page.getByTestId('save-draft').click();
  await expect(page.getByTestId('follow-up-excluded')).toBeVisible();
  const key = crypto.randomUUID();
  expect(
    (
      await page.request.post(`${API}/sessions/${fixture.sessionId}/next`, {
        headers: { authorization: `Bearer ${fixture.token}`, 'idempotency-key': key },
        data: { clientEventId: key },
      })
    ).ok(),
  ).toBe(true);
  await expect(page.getByTestId('consultation-changed')).toBeVisible();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByTestId('consultation-switch').click();
  await expect(page.getByTestId('follow-up-days')).toHaveValue('0');
  expect(await stored(fixture)).toMatchObject({
    diagnosis_text: 'Excluded follow-up guard (Demo)',
    follow_up_date: null,
    signed_at: null,
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('consultation-switch').click();
  await expect(page.getByTestId('visit-diagnosis')).toHaveValue('');
});

test('short viewport at 200-percent equivalent scaling keeps editing and actions usable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 450 });
  await openDoctor(page, await createConsoleSession(4));
  await page.getByTestId('visit-diagnosis').fill('Keyboard and zoom review (Demo)');
  await custom(page, '৫');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByTestId('save-draft')).toBeInViewport();
  await expect(page.getByTestId('sign-and-next')).toBeInViewport();
  await page.getByTestId('sign-and-next').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('doctor-sign-summary')).toBeVisible();
  await page.getByRole('button', { name: /রেকর্ডে ফিরুন|Back to record/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sign-and-next')).toBeFocused();
  await expect(page.getByTestId('follow-up-days')).toHaveValue('৫');
  await shot(page, 'keyboard-zoom-equivalent');
});

test('expired patient code writes no grant; authorised records are audited and close on encounter change', async ({
  page,
}) => {
  const fixture = await openDoctor(page, await createConsoleSession(4));
  const patient = await registrationDatabase(
    async (client) =>
      (
        await client.query<{ id: string; owner_user_id: string }>(
          'SELECT id,owner_user_id FROM patients WHERE owner_user_id IS NOT NULL AND deleted_at IS NULL ORDER BY created_at,id LIMIT 1',
        )
      ).rows[0],
  );
  if (patient === undefined) throw new Error('Missing seeded owned profile');
  const count = async () =>
    await registrationDatabase(
      async (client) =>
        (
          await client.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM consents WHERE patient_id=$1 AND hospital_id=$2',
            [patient.id, fixture.hospitalId],
          )
        ).rows[0]?.n,
    );
  const before = await count();
  const expired = await signToken({
    kind: 'consent',
    claims: { sub: patient.id, kind: 'patient' },
    expiresIn: '-1s',
  });
  await page.getByTestId('consent-code-input').fill(expired);
  await page.getByTestId('open-consented-records').click();
  await expect(page.getByTestId('consent-code-input')).toHaveAttribute('aria-invalid', 'true');
  expect(await count()).toBe(before);
  const patientToken = await signToken({
    kind: 'access',
    claims: { sub: patient.owner_user_id, kind: 'patient' },
  });
  const offer = await page.request.post(`${API}/patients/${patient.id}/consent-offer`, {
    headers: { authorization: `Bearer ${patientToken}`, 'idempotency-key': crypto.randomUUID() },
    data: {},
  });
  expect(offer.ok()).toBe(true);
  const code = ((await offer.json()) as { data: { code: string } }).data.code;
  const granted = page.waitForResponse(
    (response) => response.url() === `${API}/consents/qr` && response.request().method() === 'POST',
  );
  await page.getByTestId('consent-code-input').fill(code);
  await page.getByTestId('open-consented-records').click();
  const receipt = ((await (await granted).json()) as { data: { consentId: string } }).data;
  await expect(page.getByTestId('consented-records')).toBeVisible();
  await registrationDatabase(async (client) => {
    const grant = await client.query<{ patient_id: string; hospital_id: string }>(
      'SELECT patient_id,hospital_id FROM consents WHERE id=$1',
      [receipt.consentId],
    );
    expect(grant.rows[0]).toMatchObject({
      patient_id: patient.id,
      hospital_id: fixture.hospitalId,
    });
    const audits = await client.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM audit_log WHERE subject_id=$1 AND patient_id=$2',
      [receipt.consentId, patient.id],
    );
    expect(audits.rows[0]?.n).toBeGreaterThan(0);
  });
  await shot(page, 'authorised-patient-code-records');
  await page.getByTestId('visit-diagnosis').fill('Protected record switch review (Demo)');
  await signAndNext(page);
  await expect(page.getByTestId('visit-diagnosis')).toHaveValue('');
  await expect(page.getByTestId('consented-records')).toHaveCount(0);
});

for (const code of ['PADMA', 'KARNAPHULI'] as const)
  test(`doctor uses the actual ${code} hospital identity and branding`, async ({ page }) => {
    const hospitalId = await registrationDatabase(
      async (client) =>
        (await client.query<{ id: string }>('SELECT id FROM hospitals WHERE code=$1', [code]))
          .rows[0]?.id,
    );
    if (hospitalId === undefined) throw new Error('Missing seeded hospital');
    await openDoctor(page, await createConsoleSession(4, 'in-chamber', { hospitalId }));
    await expect(page.locator('.cf-identity-copy strong')).toContainText(
      code === 'PADMA' ? 'পদ্মা' : 'কর্ণফুলী',
    );
    if (code === 'PADMA') await expect(page.locator('.cf-logo img')).toBeVisible();
    await shot(page, `brand-${code.toLowerCase()}`);
    await axe(page);
  });
