/** Real sign review is a deliberate extra step (FR-DOC-08, GR-01). */
import { expect, type Page } from '@playwright/test';

import { registrationDatabase } from './registration.js';
import { DEMO_PASSWORD } from './staff.js';

import type { ConsoleSession } from './console.js';

export async function openDoctor(page: Page, fixture: ConsoleSession): Promise<ConsoleSession> {
  const email = await registrationDatabase(
    async (client) =>
      (
        await client.query<{ email: string }>('SELECT email FROM staff_users WHERE id=$1', [
          fixture.doctorStaffId,
        ])
      ).rows[0]?.email,
  );
  const response = await page.request.post('http://localhost:4000/api/v1/staff/login', {
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
  await page.addInitScript(
    (stored) => {
      if (sessionStorage.getItem('console.demo-session') === null)
        sessionStorage.setItem('console.demo-session', stored);
    },
    JSON.stringify({
      token: payload.data.access,
      hospitalId: fixture.hospitalId,
      role: 'doctor',
      staffName: payload.data.staff.fullName,
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
  return { ...fixture, doctorToken: payload.data.access };
}

export async function signAndNext(page: Page, repeat = false): Promise<void> {
  await page.getByTestId('sign-and-next').click();
  await expect(page.getByTestId('doctor-sign-summary')).toBeVisible();
  if (repeat) await page.getByTestId('doctor-confirm-sign').dblclick();
  else await page.getByTestId('doctor-confirm-sign').click();
}
