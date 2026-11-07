/** Real integrated staff access with synthetic accounts (FR-SEC-06/10,
 * FR-ROLE-01, FR-REC-32, GR-06). No prototype simulation or real providers.
 */
import { randomUUID } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';

import { CONSOLE as COPY } from '../shared/i18n/src/messages.js';

import { adminToken, createConsoleSession, hideFromPicker } from './support/console.js';
import { E2E_DATABASE_URL, assertLocalDatabase } from './support/database.js';
import { staffWithRoles, DEMO_PASSWORD } from './support/staff.js';
import { completeSetup } from './support/twoFactor.js';

const URL = 'http://localhost:3100';
const API = 'http://localhost:4000/api/v1';
const KEY = 'console.demo-session';
const screenshots = resolve('docs/design/console-access');
async function login(page: Page, email: string, password = DEMO_PASSWORD): Promise<void> {
  await page.goto(`${URL}/?login=1`);
  const signed = await page.evaluate(
    (key) =>
      (JSON.parse(sessionStorage.getItem(key) ?? '{}') as { authKind?: string }).authKind ===
      'staff',
    KEY,
  );
  if (signed) {
    await page.getByTestId('picker-sign-out').click();
    await expect(page.getByTestId('picker-login-link')).toBeVisible({ timeout: 30_000 });
    await page.goto(`${URL}/?login=1`);
  }
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
}
async function owner<T>(body: (client: Client) => Promise<T>): Promise<T> {
  assertLocalDatabase();
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return await body(client);
  } finally {
    await client.end();
  }
}
async function desk(
  staffId: string,
  hospitalId: string,
  doctorIds: readonly string[],
): Promise<string> {
  return await owner(async (client) => {
    const id = randomUUID();
    await client.query(
      'INSERT INTO reception_desks(id,hospital_id,name_bn,name_en) VALUES($1,$2,$3,$4)',
      [
        id,
        hospitalId,
        `প্রবেশ যাচাই (ডেমো) ${id.slice(0, 5)}`,
        `Access review (Demo) ${id.slice(0, 5)}`,
      ],
    );
    await client.query(
      'INSERT INTO reception_desk_staff(desk_id,staff_user_id,hospital_id) VALUES($1,$2,$3)',
      [id, staffId, hospitalId],
    );
    for (const doctorId of doctorIds)
      await client.query(
        'INSERT INTO reception_desk_doctors(desk_id,doctor_id,hospital_id) VALUES($1,$2,$3)',
        [id, doctorId, hospitalId],
      );
    return id;
  });
}
async function apiToken(page: Page): Promise<string> {
  return await page.evaluate(
    (key) => (JSON.parse(sessionStorage.getItem(key) ?? '{}') as { token: string }).token,
    KEY,
  );
}

test('single facility roles land directly; switching work remains reachable', async ({ page }) => {
  test.setTimeout(180_000); // Four complete login, workspace and logout flows.
  for (const [role, marker] of [
    ['ward', 'ward-board'],
    ['emergency', 'er-console'],
    ['lab', 'lab-console'],
    ['pharmacy', 'pharmacy-console'],
  ] as const) {
    const staff = await staffWithRoles('JAMUNA', [role]);
    await login(page, staff.email);
    await expect(page).toHaveURL(new RegExp(`view=${role === 'emergency' ? 'er' : role}`));
    // URL and actual workspace content, not just a selected role label.
    await expect(page.getByTestId('console-picker')).toHaveCount(0);
    await expect(page.getByTestId(marker)).toBeVisible();
    await page.goto(URL);
    await expect(page.getByTestId('console-picker')).toBeVisible();
    await page.getByTestId('picker-sign-out').click();
    await expect(page.getByTestId('picker-login-link')).toBeVisible();
  }
});
test('multiple roles require selection and unauthorized URL/cache labels do not grant access', async ({
  page,
}) => {
  const staff = await staffWithRoles('JAMUNA', ['ward', 'lab']);
  await login(page, staff.email);
  await expect(page.getByTestId('choose-role-ward')).toBeVisible();
  await expect(page.getByTestId('choose-role-lab')).toBeVisible();
  await page.getByTestId('choose-role-lab').click();
  await expect(page).toHaveURL(/view=lab/);
  const privateCalls: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/admin/')) privateCalls.push(request.url());
  });
  await page.evaluate((key) => {
    const s = JSON.parse(sessionStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    s['role'] = 'hospital_admin';
    s['roles'] = ['hospital_admin'];
    sessionStorage.setItem(key, JSON.stringify(s));
  }, KEY);
  await page.goto(`${URL}/?view=admin`);
  await expect(page.getByTestId('console-picker')).toBeVisible();
  await expect(page.getByTestId('admin-dashboard')).toHaveCount(0);
  expect(privateCalls).toEqual([]);
});
test('own desks are filtered; an assigned empty desk has no chamber fallback', async ({ page }) => {
  const staff = await staffWithRoles('JAMUNA', ['receptionist']);
  const other = await staffWithRoles('JAMUNA', ['receptionist']);
  const d1 = await desk(staff.id, staff.hospitalId!, []);
  const d2 = await desk(staff.id, staff.hospitalId!, []);
  const foreign = await desk(other.id, staff.hospitalId!, []);
  await login(page, staff.email);
  await expect(page.getByTestId(`picker-desk-${d1}`)).toBeVisible();
  await expect(page.getByTestId(`picker-desk-${d2}`)).toBeVisible();
  await expect(page.getByTestId(`picker-desk-${foreign}`)).toHaveCount(0);
  await page.getByTestId(`picker-desk-${d1}`).click();
  await expect(page.getByTestId('picker-no-chambers')).toBeVisible();
  await expect(page.locator('[data-testid^="open-receptionist-"]')).toHaveCount(0);
});
test('one assigned desk with one chamber lands there; changing assignment denies its remembered URL', async ({
  page,
}) => {
  const staff = await staffWithRoles('JAMUNA', ['receptionist']);
  const chamber = await owner(
    async (client) =>
      (
        await client.query<{ id: string; doctor_id: string }>(
          "SELECT id,doctor_id FROM sessions WHERE hospital_id=$1 AND status IN ('scheduled','running','paused') AND session_date=(now() AT TIME ZONE 'Asia/Dhaka')::date AND room IS DISTINCT FROM 'E2E' ORDER BY planned_start LIMIT 1",
          [staff.hospitalId],
        )
      ).rows[0]!,
  );
  const assigned = await desk(staff.id, staff.hospitalId!, [chamber.doctor_id]);
  await login(page, staff.email);
  // Batch 3A opens the desk as one workspace containing its permitted chambers.
  await expect(page).toHaveURL(/view=reception/);
  await expect(page.getByTestId(`reception-chamber-${chamber.id}`)).toBeVisible();
  const used = page.url();
  await owner(async (client) => {
    await client.query('DELETE FROM reception_desk_staff WHERE desk_id=$1 AND staff_user_id=$2', [
      assigned,
      staff.id,
    ]);
  });
  await desk(staff.id, staff.hospitalId!, []);
  await page.goto(used);
  await expect(page.getByTestId('console-picker')).toBeVisible();
  await expect(page.locator('[data-session-id]')).toHaveCount(0);
});
test('no assigned desk keeps V1 common access; doctors still choose a chamber explicitly', async ({
  page,
}) => {
  const reception = await staffWithRoles('JAMUNA', ['receptionist']);
  await login(page, reception.email);
  await expect(page.getByText(COPY.accessCommonDesk.bn)).toBeVisible();
  await expect(page.locator('[data-testid^="open-receptionist-"]').first()).toBeVisible();
  const doctor = await staffWithRoles('JAMUNA', ['doctor']);
  await login(page, doctor.email);
  await expect(page.getByText(COPY.accessDoctorChoice.bn)).toBeVisible();
  await expect(page.locator('[data-testid^="open-doctor-"]').first()).toBeVisible();
  await expect(page.getByTestId('sign-and-next')).toHaveCount(0);
});
test('removed role ends access rather than trusting a previous choice', async ({ page }) => {
  const staff = await staffWithRoles('JAMUNA', ['lab']);
  await login(page, staff.email);
  await expect(page).toHaveURL(/view=lab/);
  const token = await adminToken(staff.hospitalId!);
  const response = await page.request.patch(`${API}/hospital/staff/${staff.id}`, {
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() },
    data: { roles: ['ward'] },
  });
  expect(response.ok()).toBe(true);
  await page.reload();
  await expect(page.getByTestId('staff-login')).toBeVisible();
  await expect(page.getByTestId('login-ended')).toBeVisible();
});
test('national viewers land without a hospital roster read; platform entry remains forbidden', async ({
  page,
}) => {
  const staff = await staffWithRoles(null, ['gov_viewer']);
  const rosters: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/staff/chambers')) rosters.push(request.url());
  });
  await login(page, staff.email);
  await expect(page).toHaveURL(/view=gov/);
  expect(rosters).toEqual([]);
  await page.goto(`${URL}/?view=platform`);
  await expect(page.getByTestId('console-picker')).toBeVisible();
  await expect(page.getByTestId('platform-console')).toHaveCount(0);
});
test('a platform administrator must complete MFA and remains outside hospital workspaces', async ({
  page,
}) => {
  test.setTimeout(120_000); // MFA enrolment and both national/hospital route checks.
  const staff = await staffWithRoles(null, ['platform_admin']);
  const rosters: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/staff/chambers')) rosters.push(request.url());
  });
  await login(page, staff.email);
  await expect(page.getByTestId('two-factor-setup')).toBeVisible();
  await expect(page.getByTestId('tfa-setup-cancel')).toHaveCount(0);
  await completeSetup(page, staff.email);
  await expect(page.getByTestId('platform-console')).toBeVisible();
  expect(rosters).toEqual([]);
  await page.goto(`${URL}/?view=ward`);
  await expect(page.getByTestId('console-picker')).toBeVisible();
  await expect(page.getByTestId('ward-board')).toHaveCount(0);
});
test('wrong credentials stay generic, lockout is real, and errors expose no hospital', async ({
  page,
}) => {
  const staff = await staffWithRoles('JAMUNA', ['lab']);
  await login(page, 'missing-access@demo.invalid', 'incorrect-password');
  const generic = await page.getByTestId('login-error').textContent();
  await login(page, staff.email, 'incorrect-password');
  await expect(page.getByTestId('login-error')).toHaveText(generic ?? '');
  await expect(page.getByTestId('staff-login')).toBeVisible();
  for (let i = 0; i < 5; i++) {
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('login-submit')).not.toHaveAttribute('aria-busy', 'true');
  }
  await expect(page.getByTestId('login-error')).not.toHaveText(generic ?? '');
  await expect(page.getByTestId('console-picker')).toHaveCount(0);
});
test('tampered browser MFA flags cannot bypass mandatory administrator setup', async ({ page }) => {
  const staff = await staffWithRoles('JAMUNA', ['hospital_admin', 'ward']);
  await login(page, staff.email);
  await expect(page.getByTestId('two-factor-setup')).toBeVisible();
  await page.evaluate((key) => {
    const s = JSON.parse(sessionStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    s['twoFactor'] = { required: false, enabled: true };
    s['mustChangePassword'] = false;
    s['role'] = 'ward';
    sessionStorage.setItem(key, JSON.stringify(s));
  }, KEY);
  await page.goto(`${URL}/?view=ward`);
  await expect(page.getByTestId('two-factor-setup')).toBeVisible();
  await expect(page.getByTestId('tfa-setup-cancel')).toHaveCount(0);
  const refused = await page.request.get(`${API}/hospital/setup`, {
    headers: { authorization: `Bearer ${await apiToken(page)}` },
  });
  expect(refused.status()).toBe(403);
});
test('offline login is blocked and server failure stays truthful', async ({ page, context }) => {
  await page.goto(`${URL}/?login=1`);
  await page.getByTestId('login-email').fill('offline@demo.invalid');
  await page.getByTestId('login-password').fill(DEMO_PASSWORD);
  await context.setOffline(true);
  await expect(page.getByTestId('login-offline')).toBeVisible();
  await expect(page.getByTestId('login-submit')).toBeDisabled();
  await context.setOffline(false);
  await page.route('**/staff/login', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":{"code":"SERVICE_UNAVAILABLE"}}',
    }),
  );
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-error')).toContainText(COPY.loginFailed.bn);
});
test('real sign-in/role screens meet bilingual tablet and keyboard checks', async ({ page }) => {
  test.setTimeout(180_000); // Six complete real sign-in/layout flows in this case.
  await mkdir(screenshots, { recursive: true });
  const staff = await staffWithRoles('JAMUNA', ['ward', 'lab']);
  for (const [width, height, name] of [
    [1440, 900, 'desktop'],
    [1024, 768, 'landscape'],
    [768, 1024, 'portrait'],
  ] as const) {
    for (const lang of ['bn', 'en'] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(`${URL}/?login=1`);
      await page.getByTestId(`language-${lang}`).click();
      await page.getByTestId('login-email').fill(staff.email);
      await page.getByTestId('login-password').fill(DEMO_PASSWORD);
      await page.getByTestId('login-show-password').click();
      await expect(page.getByTestId('login-password')).toHaveAttribute('type', 'text');
      await page.getByTestId('login-show-password').click();
      const axeSource = await readFile(resolve('node_modules/axe-core/axe.min.js'), 'utf8');
      await page.evaluate((source) => {
        const script = document.createElement('script');
        script.nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce ?? '';
        script.textContent = source;
        document.head.appendChild(script);
      }, axeSource);
      const errors = await page.evaluate(async () => {
        const a = (
          window as unknown as {
            axe: { run: (node: Document) => Promise<{ violations: { id: string }[] }> };
          }
        ).axe;
        return (await a.run(document)).violations.map((v) => v.id);
      });
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: resolve(screenshots, `signin-${name}-${lang}.png`),
        fullPage: true,
        mask: [page.getByTestId('login-password'), page.getByTestId('login-demo-note')],
        maskColor: '#c3cedc',
      });
      await page.getByRole('button', { name: /সাহায্য|Help/ }).click();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('login-email')).toHaveValue(staff.email);
      await page.getByTestId('login-submit').click();
      await expect(page.getByTestId('choose-role-ward')).toBeVisible();
      await page.screenshot({
        path: resolve(screenshots, `roles-${name}-${lang}.png`),
        fullPage: true,
      });
      await page.getByTestId('picker-sign-out').click();
      await expect(page.getByTestId('picker-login-link')).toBeVisible({ timeout: 30_000 });
    }
  }
});

test('hospital-code disambiguation keeps membership private and selects the actual hospital', async ({
  page,
}) => {
  const first = await staffWithRoles('JAMUNA', ['lab']);
  const second = await staffWithRoles('SHAPLA', ['lab']);
  await owner(async (client) => {
    await client.query('UPDATE staff_users SET email=$1 WHERE id=$2', [first.email, second.id]);
  });
  await login(page, first.email);
  await expect(page.getByTestId('login-hospital-code')).toBeVisible();
  await expect(page.getByTestId('console-picker')).toHaveCount(0);
  await page.getByTestId('login-hospital-code').fill('SHAPLA');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('lab-console')).toBeVisible();
  expect(
    await page.evaluate(
      (key) =>
        (JSON.parse(sessionStorage.getItem(key) ?? '{}') as { hospitalId: string }).hospitalId,
      KEY,
    ),
  ).toBe(second.hospitalId);
});
test('no role is reported without opening any workspace', async ({ page }) => {
  const staff = await staffWithRoles('JAMUNA', []);
  await login(page, staff.email);
  await expect(page.getByTestId('login-error')).toContainText(COPY.loginNoRoles.bn);
  await expect(page.getByTestId('console-picker')).toHaveCount(0);
});
test('another hospital chamber cannot be opened using a valid doctor sign-in', async ({ page }) => {
  const staff = await staffWithRoles('JAMUNA', ['doctor']);
  await login(page, staff.email);
  await expect(page.getByTestId('console-picker')).toBeVisible();
  const foreign = await owner(
    async (client) =>
      (
        await client.query<{ id: string }>(
          'SELECT id FROM sessions WHERE hospital_id<>$1 AND deleted_at IS NULL LIMIT 1',
          [staff.hospitalId],
        )
      ).rows[0]!.id,
  );
  await page.goto(`${URL}/?session=${foreign}`);
  await expect(page.getByTestId('console-picker')).toBeVisible();
  await expect(page.getByTestId('sign-and-next')).toHaveCount(0);
});
test('ordinary token refresh and focus checks preserve an open doctor draft', async ({ page }) => {
  const staff = await staffWithRoles('SHAPLA', ['doctor']);
  await login(page, staff.email);
  await expect(page.getByTestId('console-picker')).toBeVisible();
  const token = await apiToken(page);
  const response = await page.request.get(`${API}/staff/chambers`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const data = (await response.json()) as {
    data: { chambers: { id: string; status: string; doctorId: string }[] };
  };
  const running = data.data.chambers.find((chamber) => chamber.status === 'running');
  expect(running).toBeDefined();
  // Own a fresh canonical-fixture queue: this case tests a healthy refresh,
  // independently of whichever mutable seeded chamber happened to be first.
  const fixture = await createConsoleSession(3, 'in-chamber', {
    hospitalId: staff.hospitalId!,
    doctorId: running!.doctorId,
    room: 'Access refresh (Demo)',
  });
  try {
    await page.reload();
    await page.getByTestId(`open-doctor-${fixture.sessionId}`).click();
    const note = page.getByTestId('visit-diagnosis');
    await expect(note).toBeEnabled();
    await note.fill('Unsaved local draft (Demo)');
    // HS256 access tokens have second-resolution iat/exp. A same-second
    // renewal can have identical bytes; exercise a later-second renewal.
    const issuedAt = await page.evaluate((value) => {
      const payload = JSON.parse(
        atob(value.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')),
      ) as { iat: number };
      return payload.iat;
    }, token);
    await expect.poll(() => Math.floor(Date.now() / 1000)).toBeGreaterThan(issuedAt + 1);
    await expect(note).toHaveValue('Unsaved local draft (Demo)');
    await page.evaluate(() => {
      (window as unknown as { refreshDiagnostic: Element | null }).refreshDiagnostic =
        document.querySelector('[data-testid="visit-diagnosis"]');
    });
    const revalidated = page.waitForResponse(
      (reply) =>
        reply.url().endsWith('/staff/chambers') &&
        reply.status() === 200 &&
        reply.request().headers()['authorization'] !== `Bearer ${token}`,
    );
    await page.evaluate((key) => {
      const s = JSON.parse(sessionStorage.getItem(key) ?? '{}') as Record<string, unknown>;
      s['accessExpiresAt'] = new Date(Date.now() - 1000).toISOString();
      sessionStorage.setItem(key, JSON.stringify(s));
      window.dispatchEvent(new Event('focus'));
    }, KEY);
    await expect.poll(() => apiToken(page)).not.toBe(token);
    await revalidated;
    await page.evaluate(
      () =>
        new Promise<void>((resolveFrame) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())),
        ),
    );
    const diagnostic = await page.evaluate(() => {
      const stored = (window as unknown as { refreshDiagnostic?: Element | null })
        .refreshDiagnostic;
      return {
        referencePresent: stored !== undefined,
        sameElement: stored === document.querySelector('[data-testid="visit-diagnosis"]'),
        originalStillMounted: stored?.isConnected ?? false,
      };
    });
    await test.info().attach('refresh-mount-diagnostic', {
      body: JSON.stringify(diagnostic),
      contentType: 'application/json',
    });
    await expect(note).toHaveValue('Unsaved local draft (Demo)');
  } finally {
    await hideFromPicker([fixture.sessionId]);
  }
});
