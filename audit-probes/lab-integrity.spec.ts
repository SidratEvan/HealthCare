import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';
import { DEMO_ASSESSMENTS } from '../database/seeds/data/reference.js';
import { createConsoleSession, signVisit, type ConsoleSession } from '../e2e/support/console.js';
import { labSession } from '../e2e/support/lab.js';
import { E2E_DATABASE_URL } from '../e2e/support/database.js';

const API = 'http://localhost:4000/api/v1';
async function openLab(page: Page, demo: ConsoleSession, token: string) {
  await page.addInitScript(({ token, hospitalId }) => {
    sessionStorage.setItem('console.demo-session', JSON.stringify({ token, hospitalId, role: 'lab', staffName: 'Independent synthetic audit' }));
    localStorage.setItem('locale', 'en');
  }, { token, hospitalId: demo.hospitalId });
  await page.goto('http://localhost:3100/?view=lab');
  await expect(page.getByTestId('lab-filters')).toBeVisible();
}
async function order(page: Page, demo: ConsoleSession) {
  const bookingId = demo.bookingsBySerial.get(1)!;
  await signVisit(demo, bookingId, { diagnosisText: DEMO_ASSESSMENTS[0]!.diagnosisBn, adviceTextBn: DEMO_ASSESSMENTS[0]!.adviceBn });
  const key = crypto.randomUUID();
  const res = await page.request.post(`${API}/test-orders`, { headers: { Authorization: `Bearer ${demo.doctorToken}`, 'Idempotency-Key': key }, data: { bookingId, tests: [{ testCode: 'CBC' }], idempotencyKey: key } });
  expect(res.status()).toBe(201);
  return ((await res.json()).data.orders[0].id) as string;
}

test('an already-open lab receives a newly committed doctor order', async ({ page }, info) => {
  const demo = await createConsoleSession(1);
  const lab = await labSession(demo.hospitalId);
  await openLab(page, demo, lab.labToken);
  const requests: string[] = [];
  page.on('request', r => { if (r.url().includes('/test-orders')) requests.push(`${r.method()} ${r.url()}`); });
  const id = await order(page, demo);
  await info.attach('committed-order', { body: JSON.stringify({ id, requests }), contentType: 'application/json' });
  await expect(page.getByTestId(`lab-order-${id}`)).toBeVisible({ timeout: 10_000 });
});

test('uncertain upload must not accept another attempt as proof this file was delivered', async ({ page }, info) => {
  const demo = await createConsoleSession(1);
  const lab = await labSession(demo.hospitalId);
  const id = await order(page, demo);
  const otherKey = crypto.randomUUID();
  for (const action of ['collect', 'process']) {
    const key = crypto.randomUUID();
    const res = await page.request.patch(`${API}/test-orders/${id}/state`, { headers: { Authorization: `Bearer ${lab.labToken}`, 'Idempotency-Key': key }, data: { action, clientEventId: key, clientTs: new Date().toISOString(), idempotencyKey: key } });
    expect(res.status()).toBe(200);
  }
  const otherContent = Buffer.from('%PDF-1.4\n% synthetic competing report B\n%%EOF').toString('base64');
  await page.addInitScript(({ id, otherKey, otherContent }) => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (init?.method === 'POST' && url.endsWith(`/test-orders/${id}/report`)) {
        const original = JSON.parse(String(init.body));
        const headers = new Headers(init.headers);
        headers.set('Idempotency-Key', otherKey);
        const response = await nativeFetch(input, { ...init, headers, body: JSON.stringify({ ...original, content: otherContent, idempotencyKey: otherKey, clientEventId: otherKey }) });
        sessionStorage.setItem('audit-competitor', JSON.stringify({ originalKey: original.idempotencyKey, otherKey, status: response.status, response: await response.json() }));
        throw new TypeError('Synthetic transport loss for original upload A');
      }
      return await nativeFetch(input, init);
    };
  }, { id, otherKey, otherContent });
  await openLab(page, demo, lab.labToken);
  await page.getByTestId(`lab-upload-${id}`).click();
  await page.getByTestId(`lab-report-file-${id}`).setInputFiles({ name: 'report-A.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% synthetic original report A\n%%EOF') });
  await page.getByTestId(`lab-report-submit-${id}`).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('audit-competitor'))).not.toBeNull();
  const competitor = await page.evaluate(() => JSON.parse(sessionStorage.getItem('audit-competitor')!));
  expect(competitor.status).toBe(201);
  const db = new Client({ connectionString: E2E_DATABASE_URL });
  await db.connect();
  const rows = await db.query('SELECT id, idempotency_key, file_url, delivered_to_wallet_at FROM reports WHERE test_order_id=$1', [id]);
  await db.end();
  expect(rows.rows).toHaveLength(1);
  expect(rows.rows[0].idempotency_key).toBe(otherKey);
  await info.attach('persisted-other-attempt', { body: JSON.stringify({ competitor, rows: rows.rows }, null, 2), contentType: 'application/json' });
  // The safe outcome is retained local file plus explicit competing-upload review.
  await expect(page.getByRole('dialog')).toContainText('report-A.pdf');
});
