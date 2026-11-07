/** Synthetic browser/persisted-state safety cases (FR-DOC-08, FR-QUE-53). */
import { expect, test, type Page } from '@playwright/test';

import { createConsoleSession, type ConsoleSession } from './support/console.js';
import { signAndNext } from './support/doctor.js';
import { registrationDatabase } from './support/registration.js';
import { DEMO_PASSWORD } from './support/staff.js';

const API = 'http://localhost:4000/api/v1';

let fixture: ConsoleSession;
test.beforeEach(async () => {
  fixture = await createConsoleSession(4);
});
async function open(page: Page) {
  // Real sign-in works in both demo and compiled production configuration.
  const email = await registrationDatabase(
    async (client) =>
      (
        await client.query<{ email: string }>('SELECT email FROM staff_users WHERE id=$1', [
          fixture.doctorStaffId,
        ])
      ).rows[0]?.email,
  );
  const response = await page.request.post(`${API}/staff/login`, {
    data: { email, password: DEMO_PASSWORD },
  });
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as {
    data: {
      access: string;
      refresh: string;
      accessExpiresAt: string;
      roles: string[];
      staff: { fullName: string };
      mustChangePassword: boolean;
      twoFactor: Record<string, unknown>;
    };
  };
  fixture = { ...fixture, doctorToken: payload.data.access };
  await page.addInitScript(
    (stored: string) => {
      if (sessionStorage.getItem('console.demo-session') !== null) return;
      sessionStorage.setItem('console.demo-session', stored);
    },
    JSON.stringify({
      token: payload.data.access,
      hospitalId: fixture.hospitalId,
      staffName: payload.data.staff.fullName,
      role: 'doctor',
      roles: payload.data.roles,
      authKind: 'staff',
      refresh: payload.data.refresh,
      accessExpiresAt: payload.data.accessExpiresAt,
      mustChangePassword: payload.data.mustChangePassword,
      twoFactor: payload.data.twoFactor,
    }),
  );
  await page.goto(`http://localhost:3100/?session=${fixture.sessionId}`);
  await expect(page.getByTestId('visit-diagnosis')).toBeEnabled();
}
async function next(page: Page) {
  const key = crypto.randomUUID();
  const answer = await page.request.post(
    `http://localhost:4000/api/v1/sessions/${fixture.sessionId}/next`,
    {
      headers: { authorization: `Bearer ${fixture.token}`, 'idempotency-key': key },
      data: { clientEventId: key },
    },
  );
  expect(answer.ok()).toBe(true);
}
async function persisted() {
  return await registrationDatabase(
    async (client) =>
      (
        await client.query<{ booking_id: string; diagnosis_text: string; signed_at: Date | null }>(
          'SELECT booking_id, diagnosis_text, signed_at FROM visits WHERE booking_id=ANY($1::uuid[])',
          [[...fixture.bookingsBySerial.values()]],
        )
      ).rows,
  );
}
test('typing survives reception Next and saves only to the original encounter', async ({
  page,
}) => {
  await open(page);
  await page.getByTestId('visit-diagnosis').fill('Synthetic unfinished note A');
  await next(page);
  await expect(page.getByTestId('consultation-changed')).toBeVisible();
  await expect(page.getByTestId('visit-diagnosis')).toHaveValue('Synthetic unfinished note A');
  await expect(page.getByTestId('sign-and-next')).toBeDisabled();
  await page.getByTestId('save-draft').click();
  await expect
    .poll(async () => (await persisted())[0]?.diagnosis_text)
    .toBe('Synthetic unfinished note A');
  expect((await persisted())[0]?.booking_id).toBe(fixture.bookingsBySerial.get(1));
  await page.getByTestId('consultation-switch').click();
  await expect(page.getByTestId('visit-diagnosis')).toHaveValue('');
  expect(await persisted()).toHaveLength(1);
});

test('failed draft save preserves writing and retry persists only the original booking', async ({
  page,
}) => {
  await open(page);
  await page.getByTestId('visit-diagnosis').fill('Synthetic retry note');
  await page.route(`${API}/visits`, (route) => route.fulfill({ status: 503, json: { ok: false } }));
  await page.getByTestId('save-draft').click();
  await expect(page.getByTestId('visit-failed')).toBeVisible();
  await expect(page.getByTestId('visit-diagnosis')).toHaveValue('Synthetic retry note');
  expect(await persisted()).toHaveLength(0);
  await page.unroute(`${API}/visits`);
  await page.getByTestId('save-draft').click();
  await expect
    .poll(async () => (await persisted())[0]?.diagnosis_text)
    .toBe('Synthetic retry note');
  expect((await persisted())[0]?.booking_id).toBe(fixture.bookingsBySerial.get(1));
});

test('delayed draft receipt cannot clear or reassign a note after reception advances', async ({
  page,
}) => {
  await open(page);
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let committed!: () => void;
  const written = new Promise<void>((resolve) => {
    committed = resolve;
  });
  await page.route(`${API}/visits`, async (route) => {
    const response = await route.fetch();
    committed();
    await barrier;
    await route.fulfill({ response });
  });
  await page.getByTestId('visit-diagnosis').fill('Synthetic delayed draft');
  await page.getByTestId('save-draft').click();
  await written;
  await next(page);
  await expect(page.getByTestId('consultation-changed')).toBeVisible();
  await expect(page.getByTestId('visit-diagnosis')).toHaveValue('Synthetic delayed draft');
  await expect(page.getByTestId('visit-diagnosis')).toBeDisabled();
  release();
  await expect(page.getByTestId('visit-diagnosis')).toBeEnabled();
  await expect(page.getByTestId('visit-diagnosis')).toHaveValue('Synthetic delayed draft');
  expect((await persisted())[0]?.booking_id).toBe(fixture.bookingsBySerial.get(1));
  await page.getByTestId('consultation-switch').click();
  await expect(page.getByTestId('visit-diagnosis')).toHaveValue('');
});

test('offline writing and reconnection keep the original patient while catching up reception Next', async ({
  page,
  context,
}) => {
  await open(page);
  await page.getByTestId('visit-diagnosis').fill('Synthetic offline note');
  await context.setOffline(true);
  await page.getByTestId('visit-advice').fill('Synthetic offline advice');
  await next(page);
  expect(await persisted()).toHaveLength(0);
  await context.setOffline(false);
  await expect(page.getByTestId('consultation-changed')).toBeVisible();
  await expect(page.getByTestId('visit-diagnosis')).toHaveValue('Synthetic offline note');
  await expect(page.getByTestId('visit-advice')).toHaveValue('Synthetic offline advice');
  await page.getByTestId('save-draft').click();
  await expect
    .poll(async () => (await persisted())[0]?.diagnosis_text)
    .toBe('Synthetic offline note');
  expect((await persisted())[0]?.booking_id).toBe(fixture.bookingsBySerial.get(1));
});

test('lost successful sign reply is checked with the original key and cannot finish the next patient', async ({
  page,
}) => {
  await open(page);
  const keys: string[] = [];
  let lose = true;
  await page.route(`${API}/visits`, async (route) => {
    keys.push(route.request().headers()['idempotency-key'] ?? '');
    const response = await route.fetch();
    if (lose) {
      lose = false;
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  await page.getByTestId('visit-diagnosis').fill('Synthetic lost sign');
  await signAndNext(page);
  await expect(page.getByTestId('consultation-retry-sign')).toBeVisible();
  await expect(page.getByTestId('visit-diagnosis')).toHaveValue('Synthetic lost sign');
  expect((await persisted())[0]?.signed_at).not.toBeNull();
  await page.getByTestId('consultation-retry-sign').click();
  await expect(page.getByTestId('visit-diagnosis')).toBeEnabled();
  await expect(page.getByTestId('visit-diagnosis')).toHaveValue('');
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  await registrationDatabase(async (client) => {
    const bookings = await client.query<{ status: string }>(
      'SELECT status::text FROM bookings WHERE session_id=$1 ORDER BY serial_number',
      [fixture.sessionId],
    );
    expect(bookings.rows.map((b) => b.status)).toEqual(['done', 'in_chamber', 'booked', 'booked']);
  });
  expect(await persisted()).toHaveLength(1);
});

test('delayed signing and repeated clicks cannot replace newer queue state or finalize another patient', async ({
  page,
}) => {
  await open(page);
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let committed!: () => void;
  const written = new Promise<void>((resolve) => {
    committed = resolve;
  });
  let submissions = 0;
  await page.route(`${API}/visits`, async (route) => {
    submissions++;
    const response = await route.fetch();
    committed();
    await barrier;
    await route.fulfill({ response });
  });
  await page.getByTestId('visit-diagnosis').fill('Synthetic delayed sign');
  await signAndNext(page, true);
  await written;
  await next(page);
  await expect(page.getByTestId('consultation-changed')).toBeVisible();
  await expect(page.getByTestId('visit-diagnosis')).toHaveValue('Synthetic delayed sign');
  release();
  await expect(page.getByTestId('visit-diagnosis')).toBeEnabled();
  await expect(page.getByTestId('visit-diagnosis')).toHaveValue('');
  await expect(page.getByTestId('consultation-identity')).toContainText('৩');
  expect(submissions).toBe(1);
  const rows = await persisted();
  expect(rows).toHaveLength(1);
  expect(rows[0]?.booking_id).toBe(fixture.bookingsBySerial.get(1));
  expect(rows[0]?.signed_at).not.toBeNull();
});

test('another device’s draft is neither overwritten nor hydrated over unsaved local writing', async ({
  page,
}) => {
  await open(page);
  await page.getByTestId('visit-diagnosis').fill('Synthetic local draft');
  const key = crypto.randomUUID();
  const other = await page.request.post(`${API}/visits`, {
    headers: { authorization: `Bearer ${fixture.doctorToken}`, 'idempotency-key': key },
    data: {
      bookingId: fixture.bookingsBySerial.get(1),
      diagnosisText: 'Synthetic other device',
      expectedRevision: null,
      sign: false,
      idempotencyKey: key,
    },
  });
  expect(other.ok()).toBe(true);
  await page.getByTestId('save-draft').click();
  await expect(page.getByTestId('visit-failed')).toBeVisible();
  await expect(page.getByTestId('visit-diagnosis')).toHaveValue('Synthetic local draft');
  expect((await persisted())[0]?.diagnosis_text).toBe('Synthetic other device');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByTestId('consultation-review').click();
  await expect(page.getByTestId('visit-diagnosis')).toHaveValue('Synthetic local draft');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('consultation-review').click();
  await expect(page.getByTestId('visit-diagnosis')).toHaveValue('Synthetic other device');
  expect(await persisted()).toHaveLength(1);
});

test('saved server drafts hydrate after reload while drafts remain absent from signed history', async ({
  page,
}) => {
  await open(page);
  await page.getByTestId('visit-diagnosis').fill('Synthetic reload draft');
  await page.getByTestId('save-draft').click();
  await expect
    .poll(async () => (await persisted())[0]?.diagnosis_text)
    .toBe('Synthetic reload draft');
  await expect(page.getByTestId('visit-failed')).toHaveCount(0);
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByTestId('visit-diagnosis')).toHaveValue('Synthetic reload draft');
  expect((await persisted())[0]?.signed_at).toBeNull();
});

test('a conflicting device signature preserves the unsigned local writing for explicit review', async ({
  page,
}) => {
  await open(page);
  await page.getByTestId('visit-diagnosis').fill('Synthetic unsent local signature');
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let submitted!: () => void;
  const submittedSign = new Promise<void>((resolve) => {
    submitted = resolve;
  });
  await page.route(`${API}/visits`, async (route) => {
    submitted();
    await barrier;
    const response = await route.fetch();
    await route.fulfill({ response });
  });
  await signAndNext(page);
  await submittedSign;
  const key = crypto.randomUUID();
  const other = await page.request.post(`${API}/visits`, {
    headers: { authorization: `Bearer ${fixture.doctorToken}`, 'idempotency-key': key },
    data: {
      bookingId: fixture.bookingsBySerial.get(1),
      diagnosisText: 'Synthetic signed elsewhere',
      sign: true,
      expectedRevision: null,
      idempotencyKey: key,
    },
  });
  expect(other.ok()).toBe(true);
  await expect(page.getByTestId('consultation-changed')).toBeVisible();
  await expect(page.getByTestId('visit-diagnosis')).toHaveValue('Synthetic unsent local signature');
  release();
  await expect(page.getByTestId('consultation-review')).toBeVisible();
  await expect(page.getByTestId('visit-diagnosis')).toHaveValue('Synthetic unsent local signature');
  await expect(page.getByTestId('visit-diagnosis')).toBeDisabled();
  expect((await persisted())[0]?.diagnosis_text).toBe('Synthetic signed elsewhere');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByTestId('consultation-switch').click();
  await expect(page.getByTestId('visit-diagnosis')).toHaveValue('Synthetic unsent local signature');
});

test('stale socket messages and same-patient queue updates do not erase or borrow writing', async ({
  page,
}) => {
  let oldFrame: string | null = null;
  let inject: ((message: string) => void) | null = null;
  await page.routeWebSocket('**/socket.io/**', (socket) => {
    const server = socket.connectToServer();
    inject = (message) => socket.send(message);
    socket.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (
        typeof message === 'string' &&
        message.startsWith('42["queue.updated"') &&
        oldFrame === null
      )
        oldFrame = message;
      socket.send(message);
    });
  });
  await open(page);
  await page.getByTestId('visit-diagnosis').fill('Synthetic socket note');
  const key = crypto.randomUUID();
  const delay = await page.request.post(`${API}/sessions/${fixture.sessionId}/delay`, {
    headers: { authorization: `Bearer ${fixture.token}`, 'idempotency-key': key },
    data: { minutes: 5, reason: null, declaredBy: 'reception', clientEventId: key },
  });
  expect(delay.ok()).toBe(true);
  await expect(page.getByTestId('visit-diagnosis')).toHaveValue('Synthetic socket note');
  await next(page);
  await expect(page.getByTestId('consultation-changed')).toBeVisible();
  expect(oldFrame).not.toBeNull();
  expect(inject).not.toBeNull();
  (inject as unknown as (message: string) => void)(String(oldFrame));
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.getByTestId('consultation-changed')).toBeVisible();
  await expect(page.getByTestId('visit-diagnosis')).toHaveValue('Synthetic socket note');
  await page.getByTestId('save-draft').click();
  await expect
    .poll(async () => (await persisted())[0]?.diagnosis_text)
    .toBe('Synthetic socket note');
  expect((await persisted())[0]?.booking_id).toBe(fixture.bookingsBySerial.get(1));
});

test('late reconnect draft read cannot replace a newer acknowledged save', async ({
  page,
  context,
}) => {
  await open(page);
  await page.getByTestId('visit-diagnosis').fill('Synthetic first version');
  await page.getByTestId('save-draft').click();
  await expect(page.getByTestId('visit-diagnosis')).toBeEnabled();
  await expect
    .poll(async () => (await persisted())[0]?.diagnosis_text)
    .toBe('Synthetic first version');
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captured!: () => void;
  const capturedRead = new Promise<void>((resolve) => {
    captured = resolve;
  });
  let delayed = false;
  await page.route(`${API}/visits/booking/*`, async (route) => {
    const response = await route.fetch();
    if (!delayed) {
      delayed = true;
      captured();
      await barrier;
    }
    await route.fulfill({ response });
  });
  await context.setOffline(true);
  await context.setOffline(false);
  await capturedRead;
  await page.getByTestId('visit-diagnosis').fill('Synthetic newer version');
  await page.getByTestId('save-draft').click();
  await expect
    .poll(async () => (await persisted())[0]?.diagnosis_text)
    .toBe('Synthetic newer version');
  await expect(page.getByTestId('visit-diagnosis')).toBeEnabled();
  release();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.getByTestId('visit-diagnosis')).toHaveValue('Synthetic newer version');
  await expect(page.getByTestId('sign-and-next')).toBeEnabled();
});

test('failed test orders stay bound to the signed encounter after opening the next patient', async ({
  page,
}) => {
  await open(page);
  await page.getByTestId('visit-diagnosis').fill('Synthetic order retry note');
  await page.getByTestId('visit-tests').getByRole('button').first().click();
  let lose = true;
  const keys: string[] = [];
  await page.route(`${API}/test-orders`, async (route) => {
    keys.push(route.request().headers()['idempotency-key'] ?? '');
    const response = await route.fetch();
    if (lose) {
      lose = false;
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  await signAndNext(page);
  await expect(page.getByTestId('consultation-retry-tests')).toBeVisible();
  await expect(page.getByTestId('consultation-switch')).toBeVisible();
  await page.getByTestId('consultation-switch').click();
  await expect(page.getByTestId('visit-diagnosis')).toHaveValue('');
  await expect(page.getByTestId('consultation-test-identity')).toContainText(
    /পরীক্ষা দিন|Order tests/,
  );
  await expect(page.getByTestId('consultation-test-identity')).toContainText(/সিরিয়াল ১|Serial 1/);
  await page.getByTestId('consultation-retry-tests').click();
  await expect(page.getByTestId('consultation-retry-tests')).toHaveCount(0);
  expect(keys[0]).toBe(keys[1]);
  await registrationDatabase(async (client) => {
    const orders = await client.query<{ booking_id: string }>(
      'SELECT v.booking_id FROM test_orders o JOIN visits v ON v.id=o.visit_id WHERE v.booking_id=ANY($1::uuid[])',
      [[...fixture.bookingsBySerial.values()]],
    );
    expect(orders.rows).toEqual([{ booking_id: fixture.bookingsBySerial.get(1) }]);
  });
});
