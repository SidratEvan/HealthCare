/** Actual Registration workflow, staff scope and loss/race recovery
 * (FR-REC-14/20/32, FR-QUE-51, GR-06). Synthetic localhost fixtures only.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { queueAction, type ConsoleSession } from './support/console.js';
import { receptionFixture, secondReceptionist } from './support/reception.js';
import { registrationCounts, registrationDatabase } from './support/registration.js';
import { DEMO_PASSWORD, staffWithRoles } from './support/staff.js';

const API = 'http://localhost:4000/api/v1';
const freshPhone = (): string =>
  `019${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`;
async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('http://localhost:3100/?login=1');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(DEMO_PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('reception-workspace')).toBeVisible();
}
async function openDesk(page: Page, email: string, from?: string): Promise<void> {
  await signIn(page, email);
  await page.goto(
    `http://localhost:3100/?view=registration${from === undefined ? '' : `&from=${from}`}`,
  );
  await expect(page.getByTestId('registration-console')).toBeVisible();
  await expect(page.locator('[data-testid^="registration-add-"]').first()).toBeVisible();
}
async function newPerson(
  page: Page,
  phone: string,
  name = 'Registration patient (Demo)',
): Promise<void> {
  await page.getByTestId('finder-phone').fill(phone);
  await expect(page.getByTestId('finder-name')).toBeVisible();
  await page.getByTestId('finder-name').fill(name);
  await page.getByTestId('finder-age').fill('২৭');
  await page.getByRole('button', { name: /^(মহিলা|Female)$/ }).click();
}
async function chooseExisting(page: Page, phone: string, patientId: string): Promise<void> {
  await page.getByTestId('finder-phone').fill(phone);
  await page.getByTestId(`finder-choose-${patientId}`).click();
  await expect(page.getByTestId('registration-chosen')).toHaveCount(0);
  await page.getByTestId('finder-confirm-patient').click();
  await expect(page.getByTestId('registration-chosen')).toBeVisible();
}
async function createPerson(
  page: Page,
  chamber: ConsoleSession,
  phone: string,
  name: string,
): Promise<string> {
  const reply = await page.request.post(`${API}/registration/patients`, {
    headers: { authorization: `Bearer ${chamber.token}`, 'idempotency-key': randomUUID() },
    data: { phone, fullName: name, ageYears: 27, sex: 'female' },
  });
  expect(reply.status()).toBe(200);
  return ((await reply.json()) as { data: { patientId: string } }).data.patientId;
}
async function shot(page: Page, name: string): Promise<void> {
  const directory = resolve('docs/design/console-registration');
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => globalThis.scrollTo(0, 0));
  await page.screenshot({ path: resolve(directory, `${name}.png`), fullPage: true });
}
async function axe(page: Page): Promise<void> {
  const code = await readFile(resolve('node_modules/axe-core/axe.min.js'), 'utf8');
  await page.evaluate((source) => {
    const script = document.createElement('script');
    script.nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce ?? '';
    script.textContent = source;
    document.head.appendChild(script);
  }, code);
  const violations = await page.evaluate(async () =>
    (
      await (
        window as unknown as {
          axe: { run: (document: Document) => Promise<{ violations: { id: string }[] }> };
        }
      ).axe.run(document)
    ).violations.map((item) => item.id),
  );
  expect(violations).toEqual([]);
}

for (const lang of ['bn', 'en'] as const)
  test(`four-step Registration and actual receipt at all three sizes in ${lang}`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const fixture = await receptionFixture(2);
    const chamber = fixture.sessions[0]!;
    await openDesk(page, fixture.staff.email);
    await expect(page.locator('[data-testid^="registration-add-"]')).toHaveCount(2);
    await page.getByTestId(`language-${lang}`).click();
    for (const [width, height, size] of [
      [1440, 900, 'desktop'],
      [1024, 768, 'landscape'],
      [768, 1024, 'portrait'],
    ] as const) {
      await page.setViewportSize({ width, height });
      await shot(page, `empty-${size}-${lang}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    const phone = freshPhone();
    const id = await createPerson(page, chamber, phone, 'Household adult (Demo)');
    await createPerson(page, chamber, phone, 'Household child (Demo)');
    await page.getByTestId('finder-phone').fill(phone);
    await expect(page.locator('[data-testid^="finder-choose-"]')).toHaveCount(2);
    await shot(page, `household-${lang}`);
    await chooseExisting(page, phone, id);
    await page.getByTestId(`registration-add-${chamber.sessionId}`).click();
    await expect(page.getByTestId('registration-serial')).toHaveCount(0);
    await expect(page.getByTestId('registration-summary')).not.toContainText(
      /serial\s+5|সিরিয়াল\s+৫/,
    );
    for (const [width, height, size] of [
      [1440, 900, 'desktop'],
      [1024, 768, 'landscape'],
      [768, 1024, 'portrait'],
    ] as const) {
      await page.setViewportSize({ width, height });
      await shot(page, `summary-${size}-${lang}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await axe(page);
    await page.getByTestId('registration-submit').click();
    await expect(page.getByTestId('registration-serial')).toHaveText(lang === 'bn' ? '৫' : '5');
    for (const [width, height, size] of [
      [1440, 900, 'desktop'],
      [1024, 768, 'landscape'],
      [768, 1024, 'portrait'],
    ] as const) {
      await page.setViewportSize({ width, height });
      await shot(page, `confirmed-${size}-${lang}`);
    }
    await axe(page);
    await page.getByTestId('registration-next-patient').click();
    await expect(page.getByTestId('finder-phone')).toHaveValue('');
  });

test('new household person, validation, duplicate warning, Help and safe navigation preserve the form', async ({
  page,
  context,
}) => {
  const fixture = await receptionFixture(2);
  const phone = freshPhone();
  await openDesk(page, fixture.staff.email);
  await page.getByTestId('finder-phone').fill('12345');
  await page.getByTestId('finder-search').click();
  await expect(page.getByTestId('finder-phone')).toHaveAttribute('aria-invalid', 'true');
  await createPerson(page, fixture.sessions[0]!, phone, 'Existing household (Demo)');
  await page.getByTestId('finder-phone').fill(phone);
  await page.getByRole('button', { name: /Not listed|এই তালিকায় নেই/ }).click();
  await page.getByTestId('finder-register').click();
  await expect(page.getByTestId('finder-name')).toHaveAttribute('aria-invalid', 'true');
  await page.getByTestId('finder-name').fill('Existing household (Demo)');
  await expect(page.getByTestId('finder-duplicate')).toBeVisible();
  await shot(page, 'duplicate-warning');
  await page.getByTestId('finder-name').fill('Another household member (Demo)');
  await page.getByTestId('finder-age').fill('১৩১');
  await page.getByTestId('finder-age').blur();
  await expect(page.getByTestId('finder-age')).toHaveAttribute('aria-invalid', 'true');
  await page.getByTestId('finder-age').fill('৩২');
  await page.getByRole('button', { name: 'মহিলা', exact: true }).click();
  await page.getByRole('button', { name: /Help/ }).click();
  await shot(page, 'help-preserves-form');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('finder-name')).toHaveValue('Another household member (Demo)');
  await page.getByTestId('registration-start-over').click();
  await shot(page, 'leave-guard');
  await page.getByRole('button', { name: /Go back|ফিরে যান/ }).click();
  await expect(page.getByTestId('registration-start-over')).toBeFocused();
  await context.setOffline(true);
  await expect(page.getByTestId('registration-offline')).toBeVisible();
  await shot(page, 'offline-preserves-form');
  await expect(page.getByTestId('finder-name')).toHaveValue('Another household member (Demo)');
  await context.setOffline(false);
  await page.getByTestId('finder-register').click();
  await expect(page.getByTestId('registration-chosen')).toContainText(
    'Another household member (Demo)',
  );
  expect((await registrationCounts(`+88${phone}`, fixture.sessions[0]!.sessionId)).patients).toBe(
    2,
  );
});

test('lost profile and serial responses reconcile original attempts without duplicate rows or guessed serials', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixture = await receptionFixture(2);
  const chamber = fixture.sessions[0]!;
  const phone = freshPhone();
  await openDesk(page, fixture.staff.email, chamber.sessionId);
  const profileKeys: string[] = [];
  let dropProfile = true;
  await page.route('**/registration/patients', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    profileKeys.push(route.request().headers()['idempotency-key'] ?? '');
    if (dropProfile) {
      dropProfile = false;
      const reply = await route.fetch();
      expect(reply.status()).toBe(200);
      await route.abort('failed');
    } else await route.continue();
  });
  await newPerson(page, phone);
  await page.getByTestId('finder-register').dblclick();
  await expect(page.getByTestId('finder-error')).toContainText(/uncertain|নিশ্চিত নয়/);
  await expect(page.getByTestId('finder-name')).toHaveAttribute('readonly', '');
  await page.getByTestId('finder-register').click();
  await page.getByTestId('finder-confirm-patient').click();
  expect(profileKeys).toHaveLength(2);
  expect(new Set(profileKeys).size).toBe(1);
  const serialKeys: string[] = [];
  let dropSerial = true;
  await page.route(`**/sessions/${chamber.sessionId}/walkin`, async (route) => {
    serialKeys.push((route.request().postDataJSON() as { clientEventId: string }).clientEventId);
    if (dropSerial) {
      dropSerial = false;
      const reply = await route.fetch();
      expect(reply.status()).toBe(200);
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByTestId('registration-submit').dblclick();
  await expect(page.getByTestId('registration-error')).toContainText(/uncertain|নিশ্চিত নয়/);
  await expect(page.getByTestId('registration-serial')).toHaveCount(0);
  const another = await createPerson(page, chamber, freshPhone(), 'Later patient (Demo)');
  await queueAction(chamber, `/sessions/${chamber.sessionId}/walkin`, {
    clientEventId: randomUUID(),
    clientTs: new Date().toISOString(),
    patientId: another,
    position: 'end',
  });
  await page.getByTestId('registration-submit').click();
  await expect(page.getByTestId('registration-serial')).toHaveText('৫');
  expect(serialKeys).toHaveLength(2);
  expect(new Set(serialKeys).size).toBe(1);
  expect(await registrationCounts(`+88${phone}`, chamber.sessionId)).toEqual({
    patients: 1,
    bookings: 6,
    walkins: 2,
  });
  await shot(page, 'reconciled-original-serial');
  await page.getByTestId('registration-return-queue').click();
  await expect(page).toHaveURL(new RegExp(`session=${chamber.sessionId}`));
  await expect(page.getByTestId('queue-table')).toContainText('Registration patient (Demo)');
});

test('a pre-write connection failure retries safely with entered details retained', async ({
  page,
}) => {
  const fixture = await receptionFixture(1);
  const phone = freshPhone();
  await openDesk(page, fixture.staff.email);
  let refuse = true;
  await page.route('**/registration/patients', async (route) => {
    if (refuse && route.request().method() === 'POST') {
      refuse = false;
      await route.abort('failed');
    } else await route.continue();
  });
  await newPerson(page, phone);
  await page.getByTestId('finder-register').click();
  await expect(page.getByTestId('finder-error')).toBeVisible();
  expect((await registrationCounts(`+88${phone}`, fixture.sessions[0]!.sessionId)).patients).toBe(
    0,
  );
  await page.getByTestId('finder-register').click();
  await expect(page.getByTestId('registration-chosen')).toBeVisible();
  expect((await registrationCounts(`+88${phone}`, fixture.sessions[0]!.sessionId)).patients).toBe(
    1,
  );
});

test('two actual receptionists register concurrently and receive unique server serials', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const fixture = await receptionFixture(1);
  const chamber = fixture.sessions[0]!;
  const colleague = await secondReceptionist(fixture.code, fixture.deskId);
  const other = await browser.newContext();
  try {
    const second = await other.newPage();
    await openDesk(page, fixture.staff.email);
    await openDesk(second, colleague.email);
    const phone = freshPhone();
    await Promise.all([
      newPerson(page, phone, 'First counter patient (Demo)'),
      newPerson(second, phone, 'Second counter patient (Demo)'),
    ]);
    await Promise.all([
      page.getByTestId('finder-register').click(),
      second.getByTestId('finder-register').click(),
    ]);
    for (const actor of [page, second]) {
      await expect
        .poll(
          async () =>
            (await actor.getByTestId('registration-chosen').isVisible()) ||
            (await actor.getByTestId('finder-identity').isVisible()),
        )
        .toBe(true);
      if (await actor.getByTestId('finder-identity').isVisible())
        await actor.getByTestId('finder-confirm-patient').click();
      await actor.getByTestId(`registration-add-${chamber.sessionId}`).click();
    }
    await Promise.all([
      page.getByTestId('registration-submit').click(),
      second.getByTestId('registration-submit').click(),
    ]);
    const serials = [];
    for (const actor of [page, second]) {
      await expect(actor.getByTestId('registration-serial')).toBeVisible();
      serials.push(await actor.getByTestId('registration-serial').innerText());
    }
    expect(serials.sort()).toEqual(['৫', '৬']);
    expect(await registrationCounts(`+88${phone}`, chamber.sessionId)).toEqual({
      patients: 2,
      bookings: 6,
      walkins: 2,
    });
  } finally {
    await other.close();
  }
});

test('a profile created between lookup and submission requires canonical identity confirmation', async ({
  page,
}) => {
  const fixture = await receptionFixture(1);
  const chamber = fixture.sessions[0]!;
  const phone = freshPhone();
  await openDesk(page, fixture.staff.email);
  await newPerson(page, phone, 'Identity race (Demo)');
  const response = await page.request.post(`${API}/registration/patients`, {
    headers: { authorization: `Bearer ${chamber.token}`, 'idempotency-key': randomUUID() },
    data: { phone, fullName: 'Identity race (Demo)', ageYears: 67, sex: 'male' },
  });
  expect(response.status()).toBe(200);
  await page.getByTestId('finder-register').click();
  await expect(page.getByTestId('registration-chosen')).toHaveCount(0);
  await expect(page.getByTestId('finder-identity')).toContainText('৬৭');
  await expect(page.getByTestId('finder-identity')).toContainText('পুরুষ');
  await page.getByTestId('finder-confirm-patient').click();
  await expect(page.getByTestId('registration-chosen')).toContainText('৬৭');
  expect((await registrationCounts(`+88${phone}`, chamber.sessionId)).patients).toBe(1);
});

test('indistinguishable same-name records stop before patient confirmation or serial issuance', async ({
  page,
}) => {
  const fixture = await receptionFixture(1);
  const phone = freshPhone();
  const chamber = fixture.sessions[0]!;
  await openDesk(page, fixture.staff.email);
  const id = await createPerson(page, chamber, phone, 'Ambiguous patient (Demo)');
  await registrationDatabase(async (client) => {
    await client.query(
      `INSERT INTO patients(owner_guest_id,full_name,age_years,sex,phone,relationship,is_primary)
    SELECT owner_guest_id,full_name,age_years,sex,phone,'other',false FROM patients WHERE id=$1`,
      [id],
    );
  });
  await page.getByTestId('finder-phone').fill(phone);
  await page.getByTestId(`finder-choose-${id}`).click();
  await expect(page.getByTestId('finder-identity')).toContainText(
    /আলাদা করা যাচ্ছে না|cannot distinguish/,
  );
  await expect(page.getByTestId('finder-confirm-patient')).toHaveCount(0);
  await expect(page.getByTestId('registration-submit')).toHaveAttribute('aria-disabled', 'true');
  await shot(page, 'ambiguous-identity-stop');
});

test('an old phone lookup response cannot choose a patient under the new phone', async ({
  page,
}) => {
  const fixture = await receptionFixture(1);
  await openDesk(page, fixture.staff.email);
  const first = freshPhone(),
    second = freshPhone();
  await createPerson(page, fixture.sessions[0]!, first, 'Old phone patient (Demo)');
  let release: () => void = () => {
    throw new Error('Lookup gate not initialised');
  };
  const held = new Promise<void>((resolveHeld) => {
    release = resolveHeld;
  });
  let requested = false;
  await page.route('**/registration/patients?*', async (route) => {
    if (decodeURIComponent(route.request().url()).includes(`+88${first}`)) {
      const result = await route.fetch();
      requested = true;
      await held;
      await route.fulfill({ response: result });
    } else await route.continue();
  });
  await page.getByTestId('finder-phone').fill(first);
  await expect.poll(() => requested).toBe(true);
  await page.getByTestId('finder-phone').fill(second);
  await expect(page.getByTestId('finder-none')).toBeVisible();
  release();
  await expect(page.getByTestId('finder-results')).toHaveCount(0);
  await expect(page.getByTestId('finder-name')).toBeVisible();
});

test('a chamber ending during Registration is refused by the server and shown read-only', async ({
  page,
}) => {
  const fixture = await receptionFixture(1);
  const chamber = fixture.sessions[0]!;
  const phone = freshPhone();
  await openDesk(page, fixture.staff.email, chamber.sessionId);
  await newPerson(page, phone);
  await page.getByTestId('finder-register').click();
  await expect(page.getByTestId('registration-chosen')).toBeVisible();
  for (let serial = 1; serial < 4; serial++)
    await queueAction(chamber, `/sessions/${chamber.sessionId}/next`);
  await queueAction(chamber, `/bookings/${chamber.bookingsBySerial.get(4)!}/done`);
  await queueAction(chamber, `/sessions/${chamber.sessionId}/end`);
  await page.getByTestId('registration-submit').click();
  await expect(page.getByTestId('registration-error')).toBeVisible();
  await expect(page.getByTestId(`registration-add-${chamber.sessionId}`)).toBeDisabled();
  await expect(page.getByTestId('registration-serial')).toHaveCount(0);
  expect((await registrationCounts(`+88${phone}`, chamber.sessionId)).bookings).toBe(4);
  await shot(page, 'ended-during-registration');
});

test('revoked desk doctor assignment is refused at submission without issuing a serial', async ({
  page,
}) => {
  const fixture = await receptionFixture(1);
  const chamber = fixture.sessions[0]!;
  const phone = freshPhone();
  await openDesk(page, fixture.staff.email, chamber.sessionId);
  await newPerson(page, phone);
  await page.getByTestId('finder-register').click();
  await expect(page.getByTestId('registration-chosen')).toBeVisible();
  await registrationDatabase(async (client) => {
    await client.query('DELETE FROM reception_desk_doctors WHERE desk_id=$1', [fixture.deskId]);
  });
  await page.getByTestId('registration-submit').click();
  await expect(page.getByTestId('registration-error')).toContainText(/access|অনুমতি/);
  await expect(page.getByTestId('registration-serial')).toHaveCount(0);
  expect((await registrationCounts(`+88${phone}`, chamber.sessionId)).bookings).toBe(4);
});

test('unavailable origin has no substitute chamber; no-desk staff retain authorised common access', async ({
  page,
}) => {
  const fixture = await receptionFixture(2);
  const foreign = await receptionFixture(1);
  await signIn(page, fixture.staff.email);
  await page.goto(`/?view=registration&from=${foreign.sessions[0]!.sessionId}`);
  await expect(page.getByTestId('registration-from-queue')).toContainText(
    /not authorised|অনুমোদিত/,
  );
  await expect(page.locator('[data-testid^="registration-add-"]')).toHaveCount(0);
  await expect(page.getByTestId('registration-submit')).toHaveAttribute('aria-disabled', 'true');
  const common = await staffWithRoles(fixture.code, ['receptionist']);
  await page.goto('/');
  await page.getByTestId('picker-sign-out').click();
  await expect(
    page.getByTestId('staff-login').or(page.getByTestId('picker-login-link')),
  ).toBeVisible();
  await page.goto('/?login=1');
  await page.getByTestId('login-email').fill(common.email);
  await page.getByTestId('login-password').fill(DEMO_PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('reception-workspace')).toBeVisible();
  await page.goto('/?view=registration');
  await expect(page.locator('[data-testid^="registration-add-"]')).toHaveCount(2);
});
