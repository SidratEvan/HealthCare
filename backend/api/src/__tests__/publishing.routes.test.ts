/**
 * A hospital decides which live figures it shares (`PRD.md` `FR-NET-04`;
 * plan C5; migration 0048).
 *
 * Three figures can be kept: its serial figures, its beds, its pharmacy's
 * shelf. What this file holds to, for each: the figure leaves every public
 * answer, the answer says it is **not shared**, and nowhere does it read as
 * zero or as none. What a hospital cannot keep is what its emergency
 * department can treat.
 *
 * Runs against the seeded demonstration (`FR-DEM-01`) and leaves it as it
 * found it.
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { FACILITY_ROLES, PUBLISHABLE_FIGURES } from '@platform/domain';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';
import { forgetModules } from '../services/modules.service.js';

import { asOwner } from './support/ownerDb.js';
import { staffIdFor } from './support/queueFixture.js';
import { bearer, nationalToken, patientToken, staffToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

/** A seeded hospital that runs everything and holds something of everything. */
const CODE = 'KARNAPHULI';
/** Another, whose figures must not move when the first one's do. */
const OTHER = 'PADMA';

let app: Express;
let hospitalId: string;
let otherId: string;
let admin: string;

async function seeded(code: string): Promise<string> {
  const found = await sql<{ id: string }>`
    SELECT id FROM hospitals WHERE code = ${code} AND deleted_at IS NULL
  `.execute(db);
  const id = found.rows[0]?.id;
  if (id === undefined) throw new Error(`The seed should hold ${code} (FR-DEM-01).`);
  return id;
}

async function adminOf(id: string): Promise<string> {
  return await signToken({
    kind: 'access',
    claims: {
      sub: await staffIdFor(id, 'hospital_admin'),
      kind: 'staff',
      hospitalId: id,
      roles: [...FACILITY_ROLES],
    },
  });
}

async function keep(
  unpublished: unknown,
  token: string | null = admin,
  key: string = randomUUID(),
): Promise<request.Response> {
  const pending = request(app).put(`${BASE}/hospital/publishing`).set('Idempotency-Key', key);
  return await (token === null ? pending : pending.set('Authorization', bearer(token))).send({
    unpublished,
  });
}

interface Card {
  readonly capabilities: string[];
  readonly sittingNow: number | null;
  readonly openSerialsToday: number | null;
  readonly notShared: string[];
  readonly beds: unknown;
}

/** The hospital as the public is shown it: its card, and its bed figures beside it. */
async function card(id: string = hospitalId): Promise<Card> {
  const response = await request(app).get(`${BASE}/hospitals/${id}`).expect(200);
  const data = response.body.data as { hospital: Omit<Card, 'beds'>; beds: unknown };
  return { ...data.hospital, beds: data.beds };
}

/** The same hospital as one row of the list. */
async function listed(id: string = hospitalId): Promise<Card & { id: string }> {
  const response = await request(app).get(`${BASE}/hospitals?limit=100`).expect(200);
  const found = (response.body.data.hospitals as (Card & { id: string })[]).find(
    (entry) => entry.id === id,
  );
  if (found === undefined) throw new Error('The hospital should be in the network list.');
  return found;
}

beforeAll(async () => {
  app = createApp();
  hospitalId = await seeded(CODE);
  otherId = await seeded(OTHER);
  admin = await adminOf(hospitalId);
});

// Whatever a test kept back, the hospital shares everything again for the next.
afterEach(async () => {
  await asOwner(async (owner) => {
    await sql`
      UPDATE hospital_settings SET unpublished = '{}', modules_off = '{}'
       WHERE hospital_id IN (${hospitalId}::uuid, ${otherId}::uuid)
    `.execute(owner);
  });
  forgetModules();
});

afterAll(async () => {
  await asOwner(async (owner) => {
    await sql`
      DELETE FROM audit_log
       WHERE hospital_id IN (${hospitalId}::uuid, ${otherId}::uuid)
         AND action = 'SETTINGS_CHANGE'
         AND meta ->> 'change' IN ('publishing', 'modules')
    `.execute(owner);
  });
});

describe('PUT /hospital/publishing: who may decide', () => {
  it('the hospital’s administrator, and nobody else', async () => {
    expect((await keep(['beds'], null)).status).toBe(401);
    expect((await keep(['beds'], await staffToken(['receptionist'], hospitalId))).status).toBe(403);
    expect((await keep(['beds'], await staffToken(['doctor'], hospitalId))).status).toBe(403);
    expect((await keep(['beds'], await patientToken())).status).toBe(403);
    expect((await keep(['beds'], await nationalToken(['gov_viewer']))).status).toBe(403);
    expect((await keep(['beds'], await nationalToken(['platform_admin']))).status).toBe(403);
    // Nothing was written by any of them.
    expect((await card()).notShared).toEqual([]);

    expect((await keep(['beds'])).status).toBe(200);
    expect((await card()).notShared).toEqual(['beds']);
  });

  it('only the three figures, each once', async () => {
    expect((await keep(['emergency'])).status).toBe(400);
    expect((await keep(['capabilities'])).status).toBe(400);
    expect((await keep(['beds', 'beds'])).status).toBe(400);
    expect((await keep('beds')).status).toBe(400);
    expect((await keep([...PUBLISHABLE_FIGURES])).status).toBe(200);
    expect((await keep([])).status).toBe(200);
  });

  it('is the hospital’s own: another hospital’s figures do not move', async () => {
    const before = await card(otherId);
    expect((await keep([...PUBLISHABLE_FIGURES])).status).toBe(200);
    expect(await card(otherId)).toEqual(before);
    expect((await card(otherId)).notShared).toEqual([]);

    // And the other's administrator writes the other's, not this one's.
    expect((await keep([])).status).toBe(200);
    expect((await keep(['stock'], await adminOf(otherId))).status).toBe(200);
    expect((await card(otherId)).notShared).toEqual(['stock']);
    expect((await card()).notShared).toEqual([]);
  });

  it('the settings read it back, and the change is in the audit log', async () => {
    expect((await keep(['stock', 'beds'])).status).toBe(200);
    const setup = await request(app)
      .get(`${BASE}/hospital/setup`)
      .set('Authorization', bearer(admin))
      .expect(200);
    expect([...(setup.body.data.hospital.unpublished as string[])].sort()).toEqual([
      'beds',
      'stock',
    ]);

    const rows = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM audit_log
       WHERE hospital_id = ${hospitalId}::uuid AND action = 'SETTINGS_CHANGE'
         AND meta ->> 'change' = 'publishing'
    `.execute(db);
    expect(Number(rows.rows[0]?.n)).toBeGreaterThan(0);
  });

  it('needs a key, and a request sent twice leaves what one would', async () => {
    // The write is the whole list, so a retry cannot add to it or undo it.
    const without = await request(app)
      .put(`${BASE}/hospital/publishing`)
      .set('Authorization', bearer(admin))
      .send({ unpublished: ['beds'] });
    expect(without.status).toBe(400);
    expect(without.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect((await card()).notShared).toEqual([]);

    const key = randomUUID();
    expect((await keep(['beds'], admin, key)).status).toBe(200);
    expect((await keep(['beds'], admin, key)).status).toBe(200);
    expect((await card()).notShared).toEqual(['beds']);
  });
});

describe('a figure kept back is not shared, and is never zero (FR-NET-04)', () => {
  it('beds: no figure on the card or in the list, and the card says which', async () => {
    const before = await card();
    expect(before.beds).not.toBeNull();
    expect(before.notShared).toEqual([]);

    await keep(['beds']);
    const after = await card();
    expect(after.beds).toBeNull();
    expect(after.notShared).toEqual(['beds']);
    expect(await listed()).toMatchObject({ beds: null, notShared: ['beds'] });
    // The other figures are untouched.
    expect(after.sittingNow).toBe(before.sittingNow);
    expect(after.openSerialsToday).toBe(before.openSerialsToday);

    // It still has that kind of bed, and is still among the hospitals that do:
    // dropping it would say it has none.
    const withKind = await request(app).get(`${BASE}/hospitals?bedKind=general&limit=100`);
    const row = (withKind.body.data.hospitals as (Card & { id: string })[]).find(
      (entry) => entry.id === hospitalId,
    );
    expect(row).toMatchObject({ beds: null, notShared: ['beds'] });

    await keep([]);
    expect((await card()).beds).toEqual(before.beds);
  });

  it('beds: an emergency result says the figure is not shared, not that there are none', async () => {
    const result = async (): Promise<{
      hasCapability: boolean | null;
      freeBeds: number | null;
      bedsShared: boolean;
      icuTotal: number | null;
    }> => {
      const found = await request(app).get(`${BASE}/emergency/search?problem=accident`).expect(200);
      const mine = (
        found.body.data.results as {
          hospitalId: string;
          hasCapability: boolean | null;
          freeBeds: number | null;
          bedsShared: boolean;
          icuTotal: number | null;
        }[]
      ).find((entry) => entry.hospitalId === hospitalId);
      if (mine === undefined) throw new Error('The hospital should be in the emergency search.');
      return mine;
    };
    const before = await result();
    expect(before.bedsShared).toBe(true);
    expect(before.freeBeds).not.toBeNull();

    await keep(['beds']);
    const after = await result();
    expect(after.bedsShared).toBe(false);
    expect(after.freeBeds).toBeNull();
    expect(after.icuTotal).toBeNull();
    // What it can treat is not the hospital's to keep.
    expect(after.hasCapability).toBe(before.hasCapability);
  });

  it('whatever is kept, what the emergency department can treat is shared', async () => {
    const before = await card();
    expect(before.capabilities.length).toBeGreaterThan(0);
    await keep([...PUBLISHABLE_FIGURES]);
    const after = await card();
    expect(after.capabilities).toEqual(before.capabilities);
    expect(after.notShared).toEqual(['serials', 'beds', 'stock']);
  });

  it('serials: the card, its doctors and its chambers', async () => {
    const before = await card();
    expect(before.sittingNow).not.toBeNull();
    expect(before.openSerialsToday).not.toBeNull();

    interface Doctor {
      readonly id: string;
      readonly sittingNow: boolean | null;
      readonly nextSessionAt: string | null;
      readonly openSerials: number | null;
      readonly serialsShared: boolean;
    }
    const doctors = async (): Promise<Doctor[]> =>
      (await request(app).get(`${BASE}/hospitals/${hospitalId}/doctors`).expect(200)).body.data
        .doctors as Doctor[];
    interface Session {
      readonly id: string;
      readonly capacity: number | null;
      readonly taken: number | null;
      readonly full: boolean;
    }
    const sessions = async (): Promise<Session[]> =>
      (await request(app).get(`${BASE}/sessions?hospitalId=${hospitalId}`).expect(200)).body.data
        .sessions as Session[];

    const doctorsBefore = await doctors();
    const sessionsBefore = await sessions();
    expect(doctorsBefore.length).toBeGreaterThan(0);
    expect(sessionsBefore.length).toBeGreaterThan(0);
    expect(doctorsBefore.every((doctor) => doctor.serialsShared)).toBe(true);
    expect(doctorsBefore.every((doctor) => doctor.sittingNow !== null)).toBe(true);
    expect(sessionsBefore.every((session) => session.taken !== null)).toBe(true);

    await keep(['serials']);

    const after = await card();
    expect(after.sittingNow).toBeNull();
    expect(after.openSerialsToday).toBeNull();
    expect(after.notShared).toEqual(['serials']);
    expect(await listed()).toMatchObject({
      sittingNow: null,
      openSerialsToday: null,
      notShared: ['serials'],
    });
    // Its beds are another decision.
    expect(after.beds).toEqual(before.beds);

    const doctorsAfter = await doctors();
    // The doctors are still listed, and when each sits is still said: that is
    // a schedule. Who is in a chamber and how many serials are left are not.
    expect(doctorsAfter.map((doctor) => doctor.id).sort()).toEqual(
      doctorsBefore.map((doctor) => doctor.id).sort(),
    );
    for (const doctor of doctorsAfter) {
      expect(doctor.serialsShared).toBe(false);
      expect(doctor.sittingNow).toBeNull();
      expect(doctor.openSerials).toBeNull();
      expect(doctor.nextSessionAt).toBe(
        doctorsBefore.find((entry) => entry.id === doctor.id)?.nextSessionAt,
      );
    }

    const sessionsAfter = await sessions();
    // The chambers are still there to book: only the count is kept.
    expect(sessionsAfter.map((session) => session.id)).toEqual(
      sessionsBefore.map((session) => session.id),
    );
    for (const session of sessionsAfter) {
      const was = sessionsBefore.find((entry) => entry.id === session.id);
      expect(session.taken).toBeNull();
      // Whether it is full is always said.
      expect(session.full).toBe(was?.full);
    }

    const first = sessionsAfter[0]?.id ?? '';
    const availability = await request(app)
      .get(`${BASE}/sessions/${first}/availability`)
      .expect(200);
    expect(availability.body.data.taken).toBeNull();
    expect(availability.body.data.remaining).toBeNull();
    // The booking's own answer, to the person about to make it.
    expect(typeof availability.body.data.nextSerial).toBe('number');
    expect(typeof availability.body.data.full).toBe('boolean');

    await keep([]);
    expect(await doctors()).toEqual(doctorsBefore);
    expect(await sessions()).toEqual(sessionsBefore);
    expect((await card()).sittingNow).toBe(before.sittingNow);
  });

  it('stock: not among the pharmacies a medicine search names', async () => {
    const medicine = await sql<{ generic_name: string }>`
      SELECT m.generic_name FROM pharmacy_stock s JOIN medicines m ON m.id = s.medicine_id
       WHERE s.hospital_id = ${hospitalId}::uuid AND s.deleted_at IS NULL
       ORDER BY m.generic_name LIMIT 1
    `.execute(db);
    const name = medicine.rows[0]?.generic_name;
    if (name === undefined) throw new Error('The seed should stock this pharmacy (FR-DEM-05).');
    const named = async (): Promise<boolean> => {
      const found = await request(app).get(
        `${BASE}/medicines?q=${encodeURIComponent(name)}&limit=50`,
      );
      return JSON.stringify(found.body).includes(hospitalId);
    };
    expect(await named()).toBe(true);
    await keep(['stock']);
    expect(await named()).toBe(false);
    expect((await card()).notShared).toEqual(['stock']);
    await keep([]);
    expect(await named()).toBe(true);
  });
});

describe('not shared is not the same as not run (FR-BRD-11)', () => {
  it('a figure whose module is off is not said to be withheld', async () => {
    await keep(['beds', 'stock']);
    expect((await card()).notShared).toEqual(['beds', 'stock']);

    await asOwner(async (owner) => {
      await sql`
        UPDATE hospital_settings SET modules_off = ARRAY['beds']
         WHERE hospital_id = ${hospitalId}::uuid
      `.execute(owner);
    });
    forgetModules();

    // It does not run beds: there is no bed figure, and nothing to withhold.
    const off = await card();
    expect(off.beds).toBeNull();
    expect(off.notShared).toEqual(['stock']);
  });
});

describe('the demonstration shows it (FR-DEM-01)', () => {
  it('one clinic keeps its serial figures, and every other facility shares everything', async () => {
    const response = await request(app).get(`${BASE}/hospitals?limit=100`).expect(200);
    const cards = response.body.data.hospitals as (Card & { nameEn: string })[];
    expect(cards.length).toBeGreaterThan(1);
    const keeping = cards.filter((entry) => entry.notShared.length > 0);
    expect(keeping.map((entry) => entry.nameEn.split(' ')[0])).toEqual(['Buriganga']);
    expect(keeping[0]).toMatchObject({
      sittingNow: null,
      openSerialsToday: null,
      notShared: ['serials'],
    });
  });
});
