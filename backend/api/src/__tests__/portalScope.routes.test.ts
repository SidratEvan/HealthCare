/**
 * What a hospital's own portal is, and is not (`PRD.md` `FR-BRD-09`,
 * `FR-BRD-10`; plan C6).
 *
 * Inside a portal every page is that hospital's, with one exception the
 * owner decided on 6 October 2026: **the emergency search stays the whole
 * network**, because somebody with a burn case is shown the nearest unit
 * that can treat it, whoever runs it. And a shared screen shares no record:
 * a patient reads their own, wherever made, and a hospital's staff read
 * another hospital's only by referral or the patient's consent, never
 * because the patient used that hospital's portal.
 *
 * A portal sends two things with a request: `scope=<code>`, and the address
 * it was opened at as the browser's `Origin`. This file sends both and holds
 * that neither narrows the one, nor widens the other.
 *
 * Runs against the seeded demonstration (`FR-DEM-01`) and writes nothing.
 */

import { sql } from 'kysely';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';

import { staffIdFor } from './support/queueFixture.js';
import { bearer, patientToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;

interface Seeded {
  readonly id: string;
  readonly code: string;
  readonly nameEn: string;
}

async function seeded(code: string): Promise<Seeded> {
  const found = await sql<{ id: string; code: string; name_en: string }>`
    SELECT id, code, name_en FROM hospitals WHERE code = ${code} AND deleted_at IS NULL
  `.execute(db);
  const row = found.rows[0];
  if (row === undefined) throw new Error(`The seed should hold ${code} (FR-DEM-01).`);
  return { id: row.id, code: row.code, nameEn: row.name_en };
}

/** A medicine some pharmacy in the demonstration has said something about. */
async function stockedMedicine(hospitalId: string): Promise<string> {
  const found = await sql<{ generic_name: string }>`
    SELECT m.generic_name FROM pharmacy_stock s JOIN medicines m ON m.id = s.medicine_id
     WHERE s.hospital_id = ${hospitalId}::uuid AND s.deleted_at IS NULL
     ORDER BY m.generic_name LIMIT 1
  `.execute(db);
  const name = found.rows[0]?.generic_name;
  if (name === undefined) throw new Error('The seed should stock this pharmacy (FR-DEM-05).');
  return name;
}

interface Pharmacy {
  readonly hospitalId: string;
}

async function pharmaciesNamed(q: string, scope?: string): Promise<string[]> {
  const suffix = scope === undefined ? '' : `&scope=${scope}`;
  const response = await request(app)
    .get(`${BASE}/medicines?q=${encodeURIComponent(q)}&limit=50${suffix}`)
    .expect(200);
  const medicines = response.body.data.medicines as { pharmacies: Pharmacy[] }[];
  return [...new Set(medicines.flatMap((entry) => entry.pharmacies.map((p) => p.hospitalId)))];
}

beforeAll(() => {
  app = createApp();
});

describe('inside a portal the emergency search is still the whole network (FR-BRD-09)', () => {
  const found = async (suffix: string): Promise<string[]> => {
    const response = await request(app)
      .get(`${BASE}/emergency/search?problem=accident${suffix}`)
      .expect(200);
    return (response.body.data.results as { hospitalId: string }[]).map(
      (entry) => entry.hospitalId,
    );
  };

  it('a scope does not narrow it: the same hospitals, in the same order, as the network’s own app', async () => {
    const padma = await seeded('PADMA');
    const network = await found('');
    expect(network.length).toBeGreaterThan(1);

    const inPortal = await found('&scope=PADMA');
    expect(inPortal).toEqual(network);
    // Hospitals that are not the portal's own are in it.
    expect(inPortal.some((id) => id !== padma.id)).toBe(true);
  });

  it('nor does a scope that names nobody turn somebody with an emergency away', async () => {
    // Every other scoped read answers 404 for a code it does not know. This
    // one does not read the code at all.
    expect(await found('&scope=NOSUCH')).toEqual(await found(''));
  });

  it('a burn case in a portal whose hospital has no burn unit is still shown one', async () => {
    const response = await request(app)
      .get(`${BASE}/emergency/search?problem=burn&scope=KARNAPHULI`)
      .expect(200);
    const results = response.body.data.results as { hasCapability: boolean | null }[];
    expect(results.some((entry) => entry.hasCapability === true)).toBe(true);
  });
});

describe('every other public read there is the hospital’s only (FR-BRD-09, FR-BRD-02)', () => {
  it('the medicine search names that hospital’s pharmacy and no other', async () => {
    const karnaphuli = await seeded('KARNAPHULI');
    const name = await stockedMedicine(karnaphuli.id);

    const network = await pharmaciesNamed(name);
    expect(network.length).toBeGreaterThan(1);
    expect(network).toContain(karnaphuli.id);

    expect(await pharmaciesNamed(name, 'KARNAPHULI')).toEqual([karnaphuli.id]);
    // Whatever the case of the code.
    expect(await pharmaciesNamed(name, 'karnaphuli')).toEqual([karnaphuli.id]);
  });

  it('a code nobody has is refused, not answered with the whole network', async () => {
    const response = await request(app).get(`${BASE}/medicines?q=para&scope=NOSUCH`);
    expect(response.status).toBe(404);
  });

  it('a hospital that keeps no shelf is not answered for by another’s', async () => {
    // Meghna runs no pharmacy (`seed_01_hospitals`).
    const karnaphuli = await seeded('KARNAPHULI');
    const name = await stockedMedicine(karnaphuli.id);
    expect(await pharmaciesNamed(name, 'MEGHNA')).toEqual([]);
  });

  it('the hospital list, the search and the bed search were already its own', async () => {
    const padma = await seeded('PADMA');
    for (const path of ['/hospitals?scope=PADMA', '/hospitals?scope=PADMA&bedKind=general']) {
      const response = await request(app).get(`${BASE}${path}`).expect(200);
      const ids = (response.body.data.hospitals as { id: string }[]).map((entry) => entry.id);
      expect(
        ids.every((id) => id === padma.id),
        path,
      ).toBe(true);
    }
    const search = await request(app).get(`${BASE}/search?scope=PADMA`).expect(200);
    expect(
      (search.body.data.hospitals as { id: string }[]).every((entry) => entry.id === padma.id),
    ).toBe(true);
  });
});

describe('a portal is told what its hospital runs and shares (FR-BRD-11, FR-NET-04)', () => {
  const scopeOf = async (code: string): Promise<{ modulesOff: string[]; notShared: string[] }> => {
    const response = await request(app).get(`${BASE}/config?scope=${code}`).expect(200);
    return response.body.data.scope as { modulesOff: string[]; notShared: string[] };
  };

  it('so that it offers no bed search without a ward and no medicine search without a shelf', async () => {
    expect(await scopeOf('PADMA')).toMatchObject({ modulesOff: [], notShared: [] });
    expect(await scopeOf('MEGHNA')).toMatchObject({ modulesOff: ['pharmacy'], notShared: [] });
    // The clinic runs no ward and keeps its serial figures.
    expect(await scopeOf('BURIGANGA')).toMatchObject({
      modulesOff: ['beds'],
      notShared: ['serials'],
    });
  });

  it('and the network’s own app is told nothing of the kind', async () => {
    const response = await request(app).get(`${BASE}/config`).expect(200);
    expect(response.body.data.scope).toBeNull();
  });
});

describe('a shared screen shares no record (FR-BRD-10, FR-NET-02, FR-SEC-04)', () => {
  interface Visit {
    readonly hospitalNameEn: string;
  }

  /** A seeded patient with signed visits at two hospitals, and no consent to the first. */
  async function seenInTwoPlaces(needsAccount: boolean): Promise<{
    patientId: string;
    userId: string | null;
    here: string;
    hereCode: string;
    hereName: string;
    elsewhereName: string;
  }> {
    const found = await sql<{
      patient_id: string;
      user_id: string | null;
      here: string;
      here_code: string;
      here_name: string;
      elsewhere_name: string;
    }>`
      SELECT a.patient_id, p.owner_user_id AS user_id, a.hospital_id AS here, ha.code AS here_code,
             ha.name_en AS here_name, hb.name_en AS elsewhere_name
        FROM visits a
        JOIN visits b ON b.patient_id = a.patient_id AND b.hospital_id <> a.hospital_id
        JOIN patients p ON p.id = a.patient_id
        JOIN hospitals ha ON ha.id = a.hospital_id
        JOIN hospitals hb ON hb.id = b.hospital_id
       WHERE a.signed_at IS NOT NULL AND b.signed_at IS NOT NULL
         AND a.deleted_at IS NULL AND b.deleted_at IS NULL
         AND (NOT ${needsAccount}::boolean OR p.owner_user_id IS NOT NULL)
         AND NOT EXISTS (
           SELECT 1 FROM consents c
            WHERE c.patient_id = a.patient_id AND c.revoked_at IS NULL AND c.deleted_at IS NULL
         )
       ORDER BY a.created_at
       LIMIT 1
    `.execute(db);
    const row = found.rows[0];
    if (row === undefined) {
      throw new Error('The seed should give some patient signed visits at two hospitals.');
    }
    return {
      patientId: row.patient_id,
      userId: row.user_id,
      here: row.here,
      hereCode: row.here_code,
      hereName: row.here_name,
      elsewhereName: row.elsewhere_name,
    };
  }

  async function doctorAt(hospitalId: string): Promise<string> {
    return await signToken({
      kind: 'access',
      claims: {
        sub: await staffIdFor(hospitalId, 'doctor'),
        kind: 'staff',
        hospitalId,
        roles: ['doctor'],
      },
    });
  }

  it('a patient in a hospital’s portal reads their own record, wherever it was made', async () => {
    const seen = await seenInTwoPlaces(true);
    if (seen.userId === null) throw new Error('unreachable: an account was asked for');
    const token = await patientToken(seen.userId);

    const plain = await request(app)
      .get(`${BASE}/patients/${seen.patientId}/records`)
      .set('Authorization', bearer(token))
      .expect(200);
    const inPortal = await request(app)
      .get(`${BASE}/patients/${seen.patientId}/records?scope=${seen.hereCode}`)
      .set('Authorization', bearer(token))
      .expect(200);

    const names = new Set((inPortal.body.data.visits as Visit[]).map((v) => v.hospitalNameEn));
    // Both hospitals, though the portal is only one of them's.
    expect(names.has(seen.hereName)).toBe(true);
    expect(names.has(seen.elsewhereName)).toBe(true);
    expect(inPortal.body.data.visits).toEqual(plain.body.data.visits);
  });

  it('the staff of the hospital whose portal it is read their own visits and no other hospital’s', async () => {
    const seen = await seenInTwoPlaces(false);
    const token = await doctorAt(seen.here);

    // As the console asks, and as if it were asked from the portal itself:
    // its scope in the question and its address as the origin.
    for (const [suffix, origin] of [
      ['', null],
      [`?scope=${seen.hereCode}`, null],
      [`?scope=${seen.hereCode}`, `https://${seen.hereCode.toLowerCase()}.portal.example`],
    ] as const) {
      const pending = request(app)
        .get(`${BASE}/patients/${seen.patientId}/records${suffix}`)
        .set('Authorization', bearer(token));
      const response = await (origin === null ? pending : pending.set('Origin', origin));

      expect(response.status, suffix).toBe(200);
      expect(response.body.data.visitsFrom, suffix).toBe('this_hospital');
      const names = new Set((response.body.data.visits as Visit[]).map((v) => v.hospitalNameEn));
      expect(names, suffix).toEqual(new Set([seen.hereName]));
      // The other hospital's name is nowhere in what was sent.
      expect(JSON.stringify(response.body), suffix).not.toContain(seen.elsewhereName);
    }
  });

  it('a hospital the patient was never seen at reads nothing, portal or not', async () => {
    const seen = await seenInTwoPlaces(false);
    const stranger = await sql<{ id: string; code: string }>`
      SELECT h.id, h.code FROM hospitals h
       WHERE h.deleted_at IS NULL AND h.is_live
         AND NOT EXISTS (SELECT 1 FROM visits v
                          WHERE v.hospital_id = h.id AND v.patient_id = ${seen.patientId}::uuid)
         AND NOT EXISTS (SELECT 1 FROM bookings b JOIN sessions s ON s.id = b.session_id
                          WHERE s.hospital_id = h.id AND b.patient_id = ${seen.patientId}::uuid)
         AND EXISTS (SELECT 1 FROM staff_roles r
                      WHERE r.hospital_id = h.id AND r.role = 'doctor' AND r.deleted_at IS NULL)
       ORDER BY h.code LIMIT 1
    `.execute(db);
    const other = stranger.rows[0];
    if (other === undefined) {
      throw new Error('The seed should have a hospital this patient was never seen at.');
    }

    const response = await request(app)
      .get(`${BASE}/patients/${seen.patientId}/records?scope=${other.code}`)
      .set('Authorization', bearer(await doctorAt(other.id)));
    expect(response.status).toBeGreaterThanOrEqual(403);
    expect(response.status).toBeLessThan(500);
    expect(JSON.stringify(response.body)).not.toContain(seen.hereName);
    expect(JSON.stringify(response.body)).not.toContain(seen.elsewhereName);
  });
});
