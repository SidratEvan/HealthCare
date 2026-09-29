/**
 * `e2e/counter-registration.spec.ts` — somebody walks up to the counter
 * (pilot step 23, `MOD-B02-WALKIN`, `S-B-03`, `FR-REC-14`, `FR-REC-20`).
 *
 * Done when "a walk-in is registered and inserted into a running chamber from
 * the counter". So: a receptionist on a running chamber types a number nobody
 * has used, registers the person in four fields, and gives them a serial; the
 * row appears in the queue with its name and walk-in source. Then the same
 * person comes back to the registration desk, is found by the number typed
 * the other way it is said, and is added to the same chamber from there.
 */

import { expect, test, type Page } from '@playwright/test';

import { createConsoleSession, eventTypes, type ConsoleSession } from './support/console.js';

let chamber: ConsoleSession;

/** A number nobody else in the run uses. */
function freshPhone(): string {
  return `019${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`;
}

async function asReceptionist(page: Page, extra: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript(
    ([token, hospitalId, more]: [string, string, Record<string, unknown>]) => {
      window.sessionStorage.setItem(
        'console.demo-session',
        JSON.stringify({
          token,
          hospitalId,
          staffName: 'E2E',
          role: 'receptionist',
          roles: ['receptionist'],
          ...more,
        }),
      );
    },
    [chamber.token, chamber.hospitalId, extra] as [string, string, Record<string, unknown>],
  );
}

test.beforeAll(async () => {
  chamber = await createConsoleSession(4);
});

test.describe('a walk-in at the counter (MOD-B02-WALKIN)', () => {
  test('registers a new person by phone and gives them the next serial', async ({ page }) => {
    await asReceptionist(page);
    await page.goto(`/?session=${chamber.sessionId}`);
    await expect(page.getByTestId('queue-table')).toBeVisible();

    const phone = freshPhone();
    await page.getByTestId('add-walkin').click();
    const sheet = page.getByTestId('walkin-sheet');
    await expect(sheet).toBeVisible();

    // Nobody under this number yet.
    await sheet.getByTestId('finder-phone').fill(phone);
    await sheet.getByTestId('finder-search').click();
    await expect(sheet.getByTestId('finder-none')).toBeVisible();

    await sheet.getByTestId('finder-name').fill('মরিয়ম আক্তার (ডেমো)');
    await sheet.getByTestId('finder-age').fill('৪৫');
    await sheet.getByRole('button', { name: 'মহিলা' }).click();
    await sheet.getByTestId('finder-register').click();

    await expect(sheet.getByTestId('walkin-patient')).toHaveText('মরিয়ম আক্তার (ডেমো)');
    await sheet.getByTestId('walkin-confirm').click();

    // Serial 5: four were booked; the walk-in is the newest.
    // The toast is read out as well as shown, so its words are on the page twice.
    await expect(
      page.getByText('মরিয়ম আক্তার (ডেমো)-কে সিরিয়াল ৫ দেওয়া হয়েছে').first(),
    ).toBeVisible();
    await expect(sheet).toBeHidden();
    await expect(page.getByTestId('queue-table')).toContainText('মরিয়ম আক্তার (ডেমো)');
    expect(await eventTypes(chamber.sessionId)).toContain('WALKIN_ADDED');
  });

  test('says a walk-in needs the connection, rather than failing on a tap', async ({
    page,
    context,
  }) => {
    await asReceptionist(page);
    await page.goto(`/?session=${chamber.sessionId}`);
    await expect(page.getByTestId('queue-table')).toBeVisible();

    await context.setOffline(true);
    await expect(page.getByTestId('offline-block')).toHaveAttribute('data-connected', 'false', {
      timeout: 20_000,
    });
    await expect(page.getByTestId('add-walkin')).toBeDisabled();
    await expect(page.getByTestId('add-walkin')).toHaveAttribute(
      'title',
      'সিরিয়াল দিতে ইন্টারনেট সংযোগ লাগবে',
    );
    await context.setOffline(false);
  });
});

test.describe('the registration desk (S-B-03)', () => {
  test('finds a returning patient by number and adds them to a chamber', async ({ page }) => {
    // Registered once at the counter, through the same finder.
    await asReceptionist(page);
    await page.goto(`/?session=${chamber.sessionId}`);
    await expect(page.getByTestId('queue-table')).toBeVisible();
    const phone = freshPhone();
    await page.getByTestId('add-walkin').click();
    const sheet = page.getByTestId('walkin-sheet');
    await sheet.getByTestId('finder-phone').fill(phone);
    await sheet.getByTestId('finder-search').click();
    await sheet.getByTestId('finder-name').fill('আবদুল করিম (ডেমো)');
    await sheet.getByTestId('finder-age').fill('67');
    await sheet.getByRole('button', { name: 'পুরুষ' }).click();
    await sheet.getByTestId('finder-register').click();
    await expect(sheet.getByTestId('walkin-patient')).toBeVisible();
    await page.keyboard.press('Escape');

    // At the desk, the number said the other way round: +880…
    await page.goto('/?view=registration');
    await expect(page.getByTestId('registration-console')).toBeVisible();
    await page.getByTestId('finder-phone').fill(`+88${phone}`);
    await page.getByTestId('finder-search').click();
    const results = page.getByTestId('finder-results');
    await expect(results).toContainText('আবদুল করিম (ডেমো)');
    await results.getByRole('button', { name: 'আবদুল করিম (ডেমো) — বেছে নিন' }).click();
    await expect(page.getByTestId('registration-chosen')).toContainText('আবদুল করিম (ডেমো)');

    // A seeded chamber: the lists hide the spec's own (room `E2E`, `chamber.repo`)
    // so a person looking at the demo never sees a test's leftovers.
    await page.locator('[data-testid^="registration-add-"]').first().click();
    await expect(page.getByText(/আবদুল করিম \(ডেমো\)-কে সিরিয়াল/).first()).toBeVisible();
    // The desk is ready for the next person.
    await expect(page.getByTestId('finder-phone')).toHaveValue('');
  });
});
