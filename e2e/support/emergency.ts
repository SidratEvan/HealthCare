/**
 * The emergency specs' fixtures (`PRD.md` §24 step 7).
 *
 * Built from the seeded demo set (CLAUDE.md §6): the seeded Padma, Jamuna and
 * Shapla, their seeded ER and ward accounts, their seeded beds. Nothing here
 * invents a facility.
 *
 * ## Freshening Padma is what a coordinator does before a demo
 *
 * Padma's burn beds and capabilities were confirmed minutes before the reset,
 * and ten minutes later they are stale — by design (`FR-OFF-04`). A suite that
 * has been running for a while would otherwise meet a Padma as stale as
 * Jamuna. So `freshenPadma` does, through the API, exactly what
 * `docs/STATUS.md` tells a presenter to do: the ER confirms its capability
 * list, and the ward cleans its free burn bed. Jamuna is left alone, hours out
 * of date, which is the other half of the scenario.
 */

import { randomUUID } from 'node:crypto';

import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

import { signToken } from '../../backend/api/src/config/jwt.js';

import { E2E_DATABASE_URL, assertLocalDatabase } from './database.js';

assertLocalDatabase();

export const API = 'http://localhost:4000/api/v1';
const CONSOLE = 'http://localhost:3100';

/** Farmgate, Dhaka: Jamuna is nearer than Padma, Shapla nearest of all. */
export const FARMGATE = { latitude: 23.758, longitude: 90.39 } as const;

async function withClient<T>(body: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({
    connectionString: E2E_DATABASE_URL,
    options: '-c search_path=public,extensions',
  });
  await client.connect();
  try {
    return await body(client);
  } finally {
    await client.end();
  }
}

export interface ErHospital {
  readonly hospitalId: string;
  readonly nameBn: string;
  /** A bearer token for the seeded ER coordinator (the demo picker's choice). */
  readonly erToken: string;
  readonly wardToken: string;
}

export async function erHospital(nameEnPrefix: string): Promise<ErHospital> {
  return await withClient(async (client) => {
    const found = await client.query<{
      id: string;
      name_bn: string;
      er_staff: string | null;
      ward_staff: string | null;
    }>(
      `SELECT h.id, h.name_bn,
              (SELECT sr.staff_user_id FROM staff_roles sr
                WHERE sr.hospital_id = h.id AND sr.role = 'emergency' AND sr.deleted_at IS NULL
                ORDER BY sr.created_at LIMIT 1) AS er_staff,
              (SELECT sr.staff_user_id FROM staff_roles sr
                WHERE sr.hospital_id = h.id AND sr.role = 'ward' AND sr.deleted_at IS NULL
                ORDER BY sr.created_at LIMIT 1) AS ward_staff
         FROM hospitals h
        WHERE h.name_en LIKE $1 || '%' AND h.deleted_at IS NULL
        LIMIT 1`,
      [nameEnPrefix],
    );
    const row = found.rows[0];
    if (row?.er_staff === null || row?.er_staff === undefined || row.ward_staff === null) {
      throw new Error(`No seeded ER at ${nameEnPrefix}. Run \`pnpm db:reset\` first.`);
    }
    const token = async (sub: string, role: string): Promise<string> =>
      await signToken({
        kind: 'access',
        claims: { sub, kind: 'staff', hospitalId: row.id, roles: [role] },
      });
    return {
      hospitalId: row.id,
      nameBn: row.name_bn,
      erToken: await token(row.er_staff, 'emergency'),
      wardToken: await token(row.ward_staff, 'ward'),
    };
  });
}

/**
 * Opens an ER console the way the demo picker leaves it (CLAUDE.md §4.1), and
 * waits for its socket: alerts and referrals only arrive over it.
 */
export async function openErConsole(page: Page, er: ErHospital): Promise<void> {
  await page.addInitScript(
    ([token, hospitalId]) => {
      sessionStorage.setItem(
        'console.demo-session',
        JSON.stringify({ token, hospitalId, staffName: 'ER (Demo)', role: 'emergency' }),
      );
    },
    [er.erToken, er.hospitalId],
  );
  await page.goto(`${CONSOLE}/?view=er`);
  await expect(page.getByTestId('er-console')).toBeVisible();
  await expect(page.getByTestId('offline-block')).toHaveAttribute('data-connected', 'true', {
    timeout: 15_000,
  });
}

async function call(
  method: 'POST' | 'PUT' | 'PATCH',
  path: string,
  token: string | null,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const key = randomUUID();
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'idempotency-key': key,
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ clientEventId: key, clientTs: new Date().toISOString(), ...body }),
  });
  const parsed = (await response.json()) as { ok: boolean; data: Record<string, unknown> };
  if (!response.ok || !parsed.ok) {
    throw new Error(`${method} ${path} → ${String(response.status)}: ${JSON.stringify(parsed)}`);
  }
  return parsed.data;
}

/** The ER confirms its capability list and the ward cleans its free burn bed. */
export async function freshenPadma(padma: ErHospital): Promise<void> {
  const { capabilities, burnBedId } = await withClient(async (client) => {
    const rows = await client.query<{ kind: string; is_available: boolean }>(
      'SELECT kind::text AS kind, is_available FROM capabilities WHERE hospital_id = $1',
      [padma.hospitalId],
    );
    const bed = await client.query<{ id: string }>(
      `SELECT id FROM beds
        WHERE hospital_id = $1 AND kind = 'burn' AND state = 'free' AND deleted_at IS NULL
        ORDER BY label LIMIT 1`,
      [padma.hospitalId],
    );
    return {
      capabilities: rows.rows.map((row) => ({ kind: row.kind, available: row.is_available })),
      burnBedId: bed.rows[0]?.id ?? null,
    };
  });

  await call('PUT', `/hospitals/${padma.hospitalId}/capabilities`, padma.erToken, {
    capabilities,
  });
  if (burnBedId === null) throw new Error('Padma should have one free burn bed (FR-DEM-04).');
  await call('POST', `/beds/${burnBedId}/clean-start`, padma.wardToken, {});
  await call('POST', `/beds/${burnBedId}/clean-done`, padma.wardToken, {});
}

/** "I'm on my way", sent straight to the API — for specs about what follows it. */
export async function sendAlert(
  hospitalId: string,
  problem: string,
): Promise<{ readonly caseId: string; readonly token: string }> {
  const data = await call('POST', '/emergency/inbound', null, {
    hospitalId,
    problem,
    phone: null,
    ageYears: 40,
    sex: 'male',
  });
  const created = data['case'] as { id: string };
  return { caseId: created.id, token: data['token'] as string };
}

/** A walk-in at an ER, as its coordinator would register one. */
export async function registerWalkIn(
  er: ErHospital,
  problem: string,
): Promise<{ readonly caseId: string; readonly token: string | null }> {
  const data = await call('POST', '/emergency/cases', er.erToken, {
    problem,
    triage: 'red',
    phone: null,
    ageYears: 55,
    sex: 'female',
  });
  const created = data['case'] as { id: string; tokenLabel: string | null };
  return { caseId: created.id, token: created.tokenLabel };
}

export async function caseState(caseId: string): Promise<{
  readonly state: string;
  readonly triage: string | null;
  readonly admitBedKind: string | null;
}> {
  return await withClient(async (client) => {
    const result = await client.query<{
      state: string;
      triage: string | null;
      admit_bed_kind: string | null;
    }>(
      `SELECT state::text AS state, triage::text AS triage, admit_bed_kind::text AS admit_bed_kind
         FROM emergency_cases WHERE id = $1`,
      [caseId],
    );
    const row = result.rows[0];
    if (row === undefined) return { state: 'missing', triage: null, admitBedKind: null };
    return { state: row.state, triage: row.triage, admitBedKind: row.admit_bed_kind };
  });
}

/** Open cases at an ER whose problem and triage match, newest first. */
export async function newestCaseAt(hospitalId: string): Promise<string | null> {
  return await withClient(async (client) => {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM emergency_cases WHERE hospital_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [hospitalId],
    );
    return result.rows[0]?.id ?? null;
  });
}

// ---------------------------------------------------------------------------
// Referrals (FR-EMG-07..09)
// ---------------------------------------------------------------------------

/** A referral sent straight to the API — for specs about what the receiver does. */
export async function sendReferral(
  from: ErHospital,
  caseId: string,
  to: ErHospital,
  need: {
    readonly requiredCapability?: string | null;
    readonly requiredBedKind?: string | null;
  } = {
    requiredCapability: 'cardiac',
  },
): Promise<string> {
  const data = await call('POST', '/referrals', from.erToken, {
    emergencyCaseId: caseId,
    toHospitalId: to.hospitalId,
    requiredCapability: null,
    requiredBedKind: null,
    ...need,
  });
  return (data['referral'] as { id: string }).id;
}

/** A step on a referral, as a console would send it. */
export async function referralStep(
  er: ErHospital,
  referralId: string,
  action: 'seen' | 'accept' | 'decline' | 'cancel' | 'arrive',
  body: Record<string, unknown> = {},
): Promise<void> {
  await call('POST', `/referrals/${referralId}/${action}`, er.erToken, body);
}

/** The newest referral of a case, as the database has it. */
export async function referralOf(caseId: string): Promise<{
  readonly id: string;
  readonly state: string;
  readonly arrivedCaseId: string | null;
} | null> {
  return await withClient(async (client) => {
    const result = await client.query<{
      id: string;
      state: string;
      arrived_case_id: string | null;
    }>(
      `SELECT id, state::text AS state, arrived_case_id FROM referrals
        WHERE emergency_case_id = $1 ORDER BY sent_at DESC LIMIT 1`,
      [caseId],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : { id: row.id, state: row.state, arrivedCaseId: row.arrived_case_id };
  });
}
