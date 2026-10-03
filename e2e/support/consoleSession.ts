/**
 * Puts a receptionist in a tab before the console loads.
 *
 * ## Two configurations, one helper
 *
 * **The demonstration** (`playwright.config.ts`, `playwright.built.config.ts`).
 * The console's picker stands in for a login (`CLAUDE.md` §4.1), and the specs
 * write the token it would have minted straight into the store it writes —
 * walking the picker in every spec would be testing the picker. That is what
 * each reception spec did inline, and it is unchanged here to the character.
 *
 * **The production configuration** (`playwright.prod.config.ts`). There is no
 * picker, and a token somebody wrote into the browser is not a session: the
 * console wants what a sign-in produces, and showed the sign-in screen to
 * every spec that tried otherwise. So here the receptionist signs in — a real
 * `POST /staff/login` with their own account, a real server-side session and a
 * real refresh token — and what is put in the tab is exactly what the sign-in
 * screen would have stored (`frontend/console/src/lib/staffAuth.ts`,
 * `adoptStaffSession`). Only the typing is left out, and that is covered where
 * it matters: `e2e/production/` signs in through the screen itself.
 *
 * The specs are otherwise untouched: what they assert about the counter is
 * true of either configuration, which is the point of running them in both.
 */

import { DEMO_PASSWORD, seededReceptionistAt } from './staff.js';

import type { ConsoleSession } from './console.js';
import type { Page } from '@playwright/test';

const API = 'http://localhost:4000/api/v1';

/** Set by `playwright.prod.config.ts`, which every worker loads first. */
export function isProductionConfiguration(): boolean {
  return process.env['E2E_CONFIGURATION'] === 'production';
}

/** What `POST /staff/login` answers for an account with no second factor. */
interface StaffSessionPayload {
  readonly requires2fa: false;
  readonly access: string;
  readonly refresh: string;
  readonly accessExpiresAt: string;
  readonly roles: readonly string[];
  readonly mustChangePassword: boolean;
  readonly staff: { readonly fullName: string };
  readonly hospital: {
    readonly id: string;
    readonly nameBn: string;
    readonly nameEn: string;
  } | null;
  readonly twoFactor: {
    readonly enabled: boolean;
    readonly required: boolean;
    readonly recoveryCodesLeft: number;
  };
}

async function signIn(hospitalId: string): Promise<Record<string, unknown>> {
  const reception = await seededReceptionistAt(hospitalId);

  const response = await fetch(`${API}/staff/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: reception.email, password: DEMO_PASSWORD }),
  });
  if (!response.ok) {
    throw new Error(`the seeded receptionist could not sign in: ${String(response.status)}`);
  }

  const body = (await response.json()) as {
    data: StaffSessionPayload | { requires2fa: true };
  };
  if (body.data.requires2fa) {
    throw new Error('the seeded receptionist is asked for a second factor; the seed gives none.');
  }
  const payload = body.data;

  // The same fields, from the same answer, as `adoptStaffSession` stores.
  return {
    token: payload.access,
    hospitalId: payload.hospital?.id ?? null,
    staffName: payload.staff.fullName,
    role: 'receptionist',
    roles: payload.roles,
    ...(payload.hospital === null
      ? {}
      : { hospitalNameBn: payload.hospital.nameBn, hospitalNameEn: payload.hospital.nameEn }),
    authKind: 'staff',
    refresh: payload.refresh,
    accessExpiresAt: payload.accessExpiresAt,
    mustChangePassword: payload.mustChangePassword,
    twoFactor: payload.twoFactor,
  };
}

export async function putReceptionistInTab(page: Page, demo: ConsoleSession): Promise<void> {
  if (!isProductionConfiguration()) {
    // The same store `ConsolePicker` writes (`CLAUDE.md` §4.1).
    await page.addInitScript((token: string) => {
      window.sessionStorage.setItem(
        'console.demo-session',
        JSON.stringify({ token, hospitalId: 'e2e', staffName: 'E2E' }),
      );
    }, demo.token);
    return;
  }

  const session = await signIn(demo.hospitalId);
  await page.addInitScript((stored: string) => {
    // Once per tab: a reload must find what the console itself wrote since —
    // a refreshed token, say — not the one from the start of the test.
    if (window.sessionStorage.getItem('console.demo-session') === null) {
      window.sessionStorage.setItem('console.demo-session', stored);
    }
  }, JSON.stringify(session));
}
