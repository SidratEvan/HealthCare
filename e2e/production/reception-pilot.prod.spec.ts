/**
 * `e2e/production/reception-pilot.prod.spec.ts` — one receptionist's day, in
 * the configuration a hospital runs (`docs/PLATFORM_PLAN.md` §2, P4).
 *
 * The first pilot is reception only: one desk, one to three chambers, every
 * patient entered at the counter, pay at the hospital, no patient app and no
 * SMS. Every step of that had a test somewhere — but each under the
 * demonstration, with a token written into the browser and a chamber a
 * fixture had already started. Nobody had ever signed in on a real server,
 * registered a walk-in, seen them through and closed the chamber, in one go.
 * A pilot that cannot do that cannot run, and this file is the only place
 * that would say so before a hospital did.
 *
 * So it is one path, end to end, with nothing skipped and nothing prepared
 * beyond what a schedule prepares each morning — two chambers for today,
 * not started, with nobody in them:
 *
 *   sign in → choose the chamber → register a walk-in → doctor arrived →
 *   call → done → end the chamber → it has left the list → the next
 *   chamber is chosen, and is its own.
 *
 * And at no point does any screen say it is a demonstration (P2).
 */

import { randomInt, randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import {
  chamberRecord,
  createConsoleSession,
  eventTypes,
  hideFromPicker,
} from '../support/console.js';
import { DEMO_PASSWORD, seededReceptionistAt } from '../support/staff.js';

const CONSOLE = 'http://localhost:3100';

/** The start of `demoBanner`, the line only a demonstration may carry. */
const DEMONSTRATION_LINE = 'এটি একটি ডেমো';

/** Fixture chambers put on the picker, to be taken back off it. */
const onPicker: string[] = [];

test.afterEach(async () => {
  await hideFromPicker(onPicker.splice(0));
});

/** A mobile number no seeded patient holds. */
function freshPhone(): string {
  return `017${String(randomInt(10_000_000, 99_999_999))}`;
}

async function saysNothingAboutADemonstration(page: Page): Promise<void> {
  await expect(page.getByTestId('demo-banner')).toHaveCount(0);
  await expect(page.getByText(DEMONSTRATION_LINE, { exact: false })).toHaveCount(0);
}

test.describe('a supervised reception pilot, start to finish (P4)', () => {
  test('sign in, register a walk-in, see them through, end the chamber, open the next', async ({
    page,
  }) => {
    const patient = 'রহিমা খাতুন (ডেমো)';

    // What a schedule leaves each morning: two chambers for today, not
    // started, nobody booked. Each in a room of its own so the picker lists
    // it (the fixture's usual room is left out of that list).
    const tag = randomUUID().slice(0, 6).toUpperCase();
    const first = await createConsoleSession(0, 'scheduled', { room: `P-${tag}-1` });
    onPicker.push(first.sessionId);
    const second = await createConsoleSession(0, 'scheduled', { room: `P-${tag}-2` });
    onPicker.push(second.sessionId);

    // --- S-B-00: the receptionist signs in with their own account -----------
    const reception = await seededReceptionistAt(first.hospitalId);
    await page.goto(CONSOLE);
    await expect(page.getByTestId('staff-login')).toBeVisible();
    await page.getByTestId('login-email').fill(reception.email);
    await page.getByTestId('login-password').fill(DEMO_PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('picker-signed-in')).toBeVisible();
    await saysNothingAboutADemonstration(page);

    // --- S-B-01: their own facility's chambers, each saying which day -------
    await expect(page.getByTestId(`chamber-card-${first.sessionId}`)).toHaveAttribute(
      'data-today',
      'true',
    );
    await expect(page.getByTestId(`chamber-when-${first.sessionId}`)).toContainText('আজ');
    await page.getByTestId(`open-receptionist-${first.sessionId}`).click();
    // Nobody is booked: the chamber opens on its empty state, said plainly.
    await expect(page.getByTestId('queue-empty')).toBeVisible();
    await expect(page.getByTestId('offline-block')).toHaveAttribute('data-connected', 'true', {
      timeout: 15_000,
    });
    await saysNothingAboutADemonstration(page);

    // --- MOD-B02-WALKIN: somebody walks up to the counter -------------------
    await page.getByTestId('add-walkin').click();
    const sheet = page.getByTestId('walkin-sheet');
    await expect(sheet).toBeVisible();
    await sheet.getByTestId('finder-phone').fill(freshPhone());
    await sheet.getByTestId('finder-search').click();
    await expect(sheet.getByTestId('finder-none')).toBeVisible();
    await sheet.getByTestId('finder-name').fill(patient);
    await sheet.getByTestId('finder-age').fill('৫২');
    await sheet.getByRole('button', { name: 'মহিলা' }).click();
    await sheet.getByTestId('finder-register').click();
    await expect(sheet.getByTestId('walkin-patient')).toHaveText(patient);
    await sheet.getByTestId('walkin-confirm').click();

    // The chamber's first serial, and she is in its queue by name.
    await expect(page.getByText(`${patient}-কে সিরিয়াল ১ দেওয়া হয়েছে`).first()).toBeVisible();
    await expect(sheet).toBeHidden();
    await expect(page.getByTestId('queue-table')).toContainText(patient);

    // --- BTN-B02-ARRIVED: the doctor is in ----------------------------------
    await page.getByRole('button', { name: 'ডাক্তার এসেছেন' }).click();
    await expect(page.getByTestId('pause-session')).toBeEnabled();

    // --- BTN-B02-NEXT: she is called ----------------------------------------
    await page.getByTestId('call-next').click();
    await expect(page.getByTestId('now-serving')).toHaveText('১');
    await expect(page.getByTestId('now-serving-name')).toHaveText(patient);
    // A chamber cannot be ended around her.
    await expect(page.getByTestId('end-chamber')).toBeDisabled();

    // --- and seen -----------------------------------------------------------
    await page.getByTestId('call-next').click();
    await expect(page.getByTestId('now-serving')).toHaveCount(0);
    await expect(page.getByTestId('pending-count')).toBeHidden();
    await expect
      .poll(async () => await eventTypes(first.sessionId))
      .toEqual(['WALKIN_ADDED', 'DOCTOR_ARRIVED', 'PATIENT_CALLED', 'PATIENT_DONE']);

    // --- BTN-B02-END: the chamber is closed ---------------------------------
    await page.getByTestId('end-chamber').click();
    await expect(page.getByTestId('end-unseen')).toHaveAttribute('data-unseen', '0');
    await page.getByTestId('end-confirm').click();
    await expect(page.getByTestId('ended-banner')).toBeVisible();
    await saysNothingAboutADemonstration(page);

    expect((await eventTypes(first.sessionId)).at(-1)).toBe('SESSION_ENDED');
    const closed = await chamberRecord(first.sessionId);
    expect(closed.status).toBe('ended');
    expect(closed.bookings).toEqual(['done']);

    // --- it has left the list, and the next chamber is the one chosen -------
    await page.getByTestId('back-to-chambers').click();
    await expect(page.getByTestId('picker-signed-in')).toBeVisible();
    await expect(page.getByTestId(`chamber-card-${second.sessionId}`)).toBeVisible();
    await expect(page.getByTestId(`chamber-card-${first.sessionId}`)).toHaveCount(0);

    await page.getByTestId(`open-receptionist-${second.sessionId}`).click();
    // Its own chamber: not ended, nobody in it, and nothing of the first's.
    await expect(page.getByTestId('queue-empty')).toBeVisible();
    await expect(page.getByTestId('ended-banner')).toHaveCount(0);
    await expect(page.getByText(patient)).toHaveCount(0);
    await saysNothingAboutADemonstration(page);

    const next = await chamberRecord(second.sessionId);
    expect(next.status).toBe('scheduled');
    expect(next.bookings).toEqual([]);
    expect(await eventTypes(second.sessionId)).toEqual([]);
  });

  test('late, absent and brought back at the counter, and the figures on the screen agree', async ({
    page,
  }) => {
    // The rest of what a desk does in week one. Pausing, resuming and undoing
    // already run under this configuration (`pause-resume.spec.ts`,
    // `console-undo.spec.ts`); these three did not, and neither did the
    // counters a receptionist checks the screen against the paper list with.
    //
    // A chamber an hour and a half in: serial 1 was seen, and serial 2 is at
    // the front of an empty chamber, long enough for the counter to call
    // them absent (`FR-QUE-20`).
    const tag = randomUUID().slice(0, 6).toUpperCase();
    const chamber = await createConsoleSession(5, 'overdue', { room: `P-${tag}-3` });
    onPicker.push(chamber.sessionId);

    const reception = await seededReceptionistAt(chamber.hospitalId);
    await page.goto(CONSOLE);
    await expect(page.getByTestId('staff-login')).toBeVisible();
    await page.getByTestId('login-email').fill(reception.email);
    await page.getByTestId('login-password').fill(DEMO_PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('picker-signed-in')).toBeVisible();
    await page.getByTestId(`open-receptionist-${chamber.sessionId}`).click();
    await expect(page.getByTestId('queue-table')).toBeVisible();
    await expect(page.getByTestId('offline-block')).toHaveAttribute('data-connected', 'true', {
      timeout: 15_000,
    });

    // As the chamber stands: one seen, four still to come.
    await expect(page.getByTestId('count-seen')).toHaveText('১');
    await expect(page.getByTestId('count-waiting')).toHaveText('৪');
    await expect(page.getByTestId('count-late')).toHaveText('০');
    await expect(page.getByTestId('count-no-show')).toHaveText('০');

    // Serial 3 rings to say they are running late.
    await page.getByTestId('queue-row-3').getByRole('button', { name: 'দেরি' }).click();
    await expect(page.getByTestId('queue-row-3')).toHaveAttribute('data-status', 'late');
    await expect(page.getByTestId('count-late')).toHaveText('১');

    // Serial 2 is not there when called.
    await page.getByTestId('queue-row-2').getByRole('button', { name: 'অনুপস্থিত' }).click();
    await expect(page.getByTestId('queue-row-2')).toHaveAttribute('data-status', 'no_show');
    await expect(page.getByTestId('count-no-show')).toHaveText('১');
    await expect(page.getByTestId('count-waiting')).toHaveText('৩');

    // …and turns up after all.
    await page.getByTestId('queue-row-2').getByRole('button', { name: 'ফিরিয়ে আনুন' }).click();
    await expect(page.getByTestId('queue-row-2')).not.toHaveAttribute('data-status', 'no_show');
    await expect(page.getByTestId('count-no-show')).toHaveText('০');
    await expect(page.getByTestId('count-waiting')).toHaveText('৪');
    await expect(page.getByTestId('count-seen')).toHaveText('১');

    // All three reached the server, in the order they were pressed, and
    // nothing was refused on the way.
    await expect(page.getByTestId('pending-count')).toBeHidden();
    await expect
      .poll(async () => (await eventTypes(chamber.sessionId)).slice(-3))
      .toEqual(['PATIENT_LATE', 'PATIENT_NO_SHOW', 'PATIENT_REINSERTED']);
    await saysNothingAboutADemonstration(page);
  });
});
