/** The reviewed date must be the filed date, including Dhaka midnight (FR-DOC-07/08). */
import { expect, test } from '@playwright/test';

import { followUpDateLabel } from '../shared/client/src/doctor/followUp.js';
import { fromDate, toDhakaDate } from '../shared/domain/src/util/time.js';

import { createConsoleSession } from './support/console.js';
import { openDoctor } from './support/doctor.js';
import { registrationDatabase } from './support/registration.js';

test('sign review retains the exact follow-up across Bangladesh midnight', async ({ page }) => {
  // Use the most recent midnight: browser time stays behind real token expiry,
  // and the five-day follow-up is still future-dated for the real server.
  const today = toDhakaDate(fromDate(new Date()));
  const midnight = Date.parse(`${today}T00:00:00+06:00`);
  const expectedDate = new Date(Date.parse(`${today}T00:00:00Z`) + 4 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  await page.clock.setFixedTime(new Date(midnight - 100));
  const fixture = await openDoctor(page, await createConsoleSession(4));
  await page.getByTestId('visit-diagnosis').fill('Midnight sign review (Demo)');
  await page.getByTestId('follow-up-custom').click();
  await page.getByTestId('follow-up-days').fill('৫');
  await page.getByTestId('sign-and-next').click();
  const reviewed = await page.getByTestId('doctor-sign-follow-up').textContent();
  expect(reviewed).toBe(followUpDateLabel(expectedDate, 'bn'));
  await page.clock.setFixedTime(new Date(midnight + 1_000));
  await expect(page.getByTestId('doctor-sign-follow-up')).toHaveText(reviewed ?? '');
  await page.getByTestId('doctor-confirm-sign').click();
  await expect
    .poll(
      async () =>
        await registrationDatabase(async (client) => {
          const result = await client.query<{ date: string; signed: boolean }>(
            'SELECT follow_up_date::text AS date,signed_at IS NOT NULL AS signed FROM visits WHERE booking_id=$1',
            [fixture.bookingsBySerial.get(1)],
          );
          return result.rows[0];
        }),
    )
    .toMatchObject({ date: expectedDate, signed: true });
});
