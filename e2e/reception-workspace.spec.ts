/** Real integrated desk workspace (FR-REC-32, FR-OFF-01, FR-QUE-05).
 * Canonical synthetic doctors/patients; actual staff login, API and sockets.
 */
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { eventCount, eventTypes, queueAction } from './support/console.js';
import { receptionFixture, secondReceptionist } from './support/reception.js';
import { DEMO_PASSWORD } from './support/staff.js';

const URL = 'http://localhost:3100';
async function signIn(page: Page, email: string): Promise<void> {
  await page.goto(`${URL}/?login=1`);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(DEMO_PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('reception-workspace')).toBeVisible();
  await expect(page).toHaveURL(/view=reception/);
}
async function screenshot(page: Page, name: string): Promise<void> {
  const directory = resolve('docs/design/console-reception');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, `${name}.png`), fullPage: true });
}

for (const count of [2, 6, 15]) {
  test(`${count} assigned doctors render their real queues without layout overflow`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const fixture = await receptionFixture(count);
    await signIn(page, fixture.staff.email);
    await expect(page.locator('[data-session-id]')).toHaveCount(count);
    for (const session of fixture.sessions)
      await expect(page.getByTestId(`now-serving-${session.sessionId}`)).toBeVisible();
    for (const [width, height, size] of [
      [1440, 900, 'desktop'],
      [1024, 768, 'landscape'],
      [768, 1024, 'portrait'],
    ] as const) {
      for (const lang of ['bn', 'en'] as const) {
        await page.setViewportSize({ width, height });
        await page.getByTestId(`language-${lang}`).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await screenshot(page, `${count}-doctors-${size}-${lang}`);
      }
    }
    await page.getByTestId(`open-receptionist-${fixture.sessions[0]!.sessionId}`).click();
    await expect(page.getByTestId(`queue-table-${fixture.sessions[0]!.sessionId}`)).toBeVisible();
    await screenshot(page, `${count}-doctors-expanded`);
    const source = await readFile(resolve('node_modules/axe-core/axe.min.js'), 'utf8');
    await page.evaluate((code) => {
      const script = document.createElement('script');
      script.nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce ?? '';
      script.textContent = code;
      document.head.appendChild(script);
    }, source);
    const violations = await page.evaluate(async () => {
      const axe = (
        window as unknown as {
          axe: { run: (document: Document) => Promise<{ violations: { id: string }[] }> };
        }
      ).axe;
      return (await axe.run(document)).violations.map((item) => item.id);
    });
    expect(violations).toEqual([]);
  });
}

test('shortcut ownership, collapse, Help and walk-in context remain bound to the selected chamber', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixture = await receptionFixture(2);
  const [a, b] = fixture.sessions;
  await signIn(page, fixture.staff.email);
  const before = await eventCount(a!.sessionId);
  await page.keyboard.press('n');
  await expect(
    page.getByText('আগে যে ডাক্তারের সিরিয়ালে কাজ করবেন', { exact: false }).first(),
  ).toBeVisible();
  expect(await eventCount(a!.sessionId)).toBe(before);
  await page.getByTestId(`open-receptionist-${a!.sessionId}`).click();
  await page.getByTestId(`open-receptionist-${b!.sessionId}`).click();
  const oldA = await eventCount(a!.sessionId);
  await page.locator('body').click({ position: { x: 2, y: 200 } });
  await page.keyboard.press('n');
  await expect(page.getByTestId(`now-serving-${b!.sessionId}`)).toHaveText('২');
  expect(await eventCount(a!.sessionId)).toBe(oldA);
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId(`now-serving-${b!.sessionId}`)).toHaveText('১');
  await page.getByTestId(`open-receptionist-${b!.sessionId}`).click();
  const oldB = await eventCount(b!.sessionId);
  await page.keyboard.press('n');
  expect(await eventCount(b!.sessionId)).toBe(oldB);
  await page.getByTestId(`add-walkin-${a!.sessionId}`).click();
  await expect(page.getByTestId('walkin-sheet')).toBeVisible();
  const phone = page.getByTestId('finder-phone');
  await phone.fill('01912345678');
  await page.keyboard.press('n');
  expect(await eventCount(a!.sessionId)).toBe(oldA);
  await page
    .getByTestId('walkin-sheet')
    .getByRole('button', { name: /সাহায্য|Help/ })
    .click();
  await page.keyboard.press('Escape');
  await expect(phone).toHaveValue('01912345678n');
  await screenshot(page, 'walk-in-help-keeps-context');
});

test('offline replay and a second receptionist reconcile both chambers independently', async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(120_000);
  const fixture = await receptionFixture(2);
  const colleague = await secondReceptionist(fixture.code, fixture.deskId);
  const [a, b] = fixture.sessions;
  await signIn(page, fixture.staff.email);
  await page.getByTestId(`open-receptionist-${a!.sessionId}`).click();
  await page.getByTestId(`open-receptionist-${b!.sessionId}`).click();
  await context.setOffline(true);
  await page.getByTestId(`call-next-${a!.sessionId}`).click();
  await page.getByTestId(`call-next-${b!.sessionId}`).click();
  await expect(page.getByTestId(`now-serving-${a!.sessionId}`)).toHaveText('২');
  await expect(page.getByTestId(`now-serving-${b!.sessionId}`)).toHaveText('২');
  await screenshot(page, 'two-chambers-offline');
  await context.setOffline(false);
  await expect(page.getByTestId(`pending-count-${a!.sessionId}`)).toBeHidden({ timeout: 30_000 });
  await expect(page.getByTestId(`pending-count-${b!.sessionId}`)).toBeHidden({ timeout: 30_000 });
  expect((await eventTypes(a!.sessionId)).filter((type) => type === 'PATIENT_CALLED')).toHaveLength(
    2,
  );
  const other = await browser.newContext();
  try {
    const second = await other.newPage();
    await signIn(second, colleague.email);
    await expect(second.getByTestId(`now-serving-${a!.sessionId}`)).toHaveText('২');
    let release: () => void = () => {
      throw new Error('Gate not initialised');
    };
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    let held = 0;
    for (const actor of [page, second])
      await actor.route('**/sync/events', async (route) => {
        held += 1;
        await gate;
        await route.continue();
      });
    await Promise.all([
      page.getByTestId(`call-next-${a!.sessionId}`).click(),
      second.getByTestId(`call-next-${a!.sessionId}`).click(),
    ]);
    await expect.poll(() => held).toBe(2);
    release();
    await expect.poll(() => eventCount(a!.sessionId)).toBe(6);
    await expect(page.getByTestId(`now-serving-${a!.sessionId}`)).toHaveText('৩');
    await expect(second.getByTestId(`now-serving-${a!.sessionId}`)).toHaveText('৩');
    await expect(page.getByTestId(`now-serving-${b!.sessionId}`)).toHaveText('২');
  } finally {
    await other.close();
  }
});

test('finished and empty chambers retain truthful controls and never issue another walk-in', async ({
  page,
}) => {
  const fixture = await receptionFixture(2);
  const a = fixture.sessions[0]!;
  for (let index = 1; index < a.bookingsBySerial.size; index++)
    await queueAction(a, `/sessions/${a.sessionId}/next`);
  await queueAction(a, `/bookings/${a.bookingsBySerial.get(a.bookingsBySerial.size)!}/done`);
  await queueAction(a, `/sessions/${a.sessionId}/end`);
  await signIn(page, fixture.staff.email);
  await expect(page.getByTestId(`call-next-${a.sessionId}`)).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(page.getByTestId(`add-walkin-${a.sessionId}`)).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.getByTestId(`open-receptionist-${a.sessionId}`).click();
  await expect(page.getByTestId(`ended-banner-${a.sessionId}`)).toBeVisible();
  await screenshot(page, 'finished-chamber');
});

test('arrival, check-in, late reinsertion, no-show, pause and resume use the actual queue rules', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixture = await receptionFixture(1, 'overdue');
  const session = fixture.sessions[0]!;
  const id = session.sessionId;
  await signIn(page, fixture.staff.email);
  await page.getByTestId(`open-receptionist-${id}`).click();
  await page.getByTestId(`check-in-2-${id}`).click();
  await expect(page.getByTestId('check-in-sheet')).toBeVisible();
  await page.getByTestId('check-in-confirm').click();
  const row = page.getByTestId(`queue-row-3-${id}`);
  await row.getByTestId(`row-more-3-${id}`).click();
  await row.getByRole('button', { name: /দেরি|Late/ }).click();
  await expect(row).toHaveAttribute('data-status', 'late');
  await row.getByRole('button', { name: /ফিরে|ফিরিয়ে|Reinstate/ }).click();
  await expect(row).toHaveAttribute('data-status', 'waiting');
  // This overdue front-of-queue patient is eligible now. Resume restarts
  // the actual server grace clock, so do not pretend it expires immediately.
  await row.getByRole('button', { name: /অনুপস্থিত|No-show/ }).click();
  await expect(row).toHaveAttribute('data-status', 'no_show');
  await expect.poll(() => eventTypes(id)).toContain('PATIENT_NO_SHOW');
  await row.getByRole('button', { name: /ফিরে|ফিরিয়ে|Reinstate/ }).click();
  await expect(row).toHaveAttribute('data-status', 'waiting');
  await page.getByTestId(`pause-session-${id}`).click();
  await expect(page.getByTestId(`paused-banner-${id}`)).toBeVisible();
  await expect(row.getByRole('button', { name: /অনুপস্থিত|No-show/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.getByTestId(`resume-session-${id}`).click();
  await expect(page.getByTestId(`paused-banner-${id}`)).toHaveCount(0);
  await expect.poll(() => eventTypes(id)).toContain('SESSION_RESUMED');
  const types = await eventTypes(id);
  for (const type of [
    'PATIENT_ARRIVED',
    'PATIENT_LATE',
    'PATIENT_REINSERTED',
    'PATIENT_NO_SHOW',
    'SESSION_PAUSED',
    'SESSION_RESUMED',
  ])
    expect(types).toContain(type);
});

test('doctor arrival is the first primary action on a scheduled chamber', async ({ page }) => {
  const fixture = await receptionFixture(1, 'scheduled');
  const id = fixture.sessions[0]!.sessionId;
  await signIn(page, fixture.staff.email);
  await page.getByTestId(`call-next-${id}`).click();
  await expect(page.getByTestId(`reception-chamber-${id}`)).toHaveAttribute(
    'data-session-status',
    'running',
  );
  await expect.poll(() => eventTypes(id)).toContain('DOCTOR_ARRIVED');
});

test('another hospital session is refused before a reception queue mounts', async ({ page }) => {
  const own = await receptionFixture(1);
  const foreign = await receptionFixture(1);
  await signIn(page, own.staff.email);
  await page.goto(`${URL}/?session=${foreign.sessions[0]!.sessionId}`);
  await expect(page.getByTestId('console-picker')).toBeVisible();
  await expect(page.getByTestId('reception-workspace')).toHaveCount(0);
});
