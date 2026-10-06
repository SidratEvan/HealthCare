/**
 * A hospital's public face is its own to set (`PRD.md` `FR-BRD-06`; plan C1;
 * migration 0045; BACKEND.md §7.7 `/hospital/brand`, `/hospital/logo`).
 *
 * What it says of itself, its colours and its logo: set by its administrator
 * and nobody else, checked before anything is kept, and shown publicly only
 * once the hospital is in the network (`FR-NET-03`).
 *
 * The writes are made at a facility this file creates, so that no seeded
 * hospital's colours change under another file; the public reads are asked of
 * the seeded ones, which are live.
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LOGO_MAX_BYTES, brandProblems, themeFromColour, type BrandTheme } from '@platform/domain';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';
import { createFirstAdministrator } from '../services/staffAuth.service.js';

import { asOwner } from './support/ownerDb.js';
import { bearer, nationalToken, patientToken, staffToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let hospitalId: string;
let admin: string;

/** The start of a PNG, and enough after it to be a file of some size. */
function png(size = 64): Buffer {
  const bytes = Buffer.alloc(size, 7);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  return bytes;
}

function write(
  method: 'put' | 'patch' | 'delete',
  path: string,
  token: string | null,
  body: object = {},
): request.Test {
  const pending = request(app)[method](`${BASE}${path}`).set('Idempotency-Key', randomUUID());
  return (token === null ? pending : pending.set('Authorization', bearer(token))).send(body);
}

async function setup(): Promise<{
  hospital: { descriptionBn: string | null; descriptionEn: string | null };
  face: {
    theme: BrandTheme | null;
    logo: { version: string; contentType: string; bytes: number } | null;
  };
}> {
  const response = await request(app)
    .get(`${BASE}/hospital/setup`)
    .set('Authorization', bearer(admin));
  expect(response.status).toBe(200);
  return response.body.data as Awaited<ReturnType<typeof setup>>;
}

async function changesRecorded(): Promise<string[]> {
  const result = await sql<{ change: string }>`
    SELECT meta ->> 'change' AS change FROM audit_log
     WHERE hospital_id = ${hospitalId}::uuid AND action = 'SETTINGS_CHANGE'
     ORDER BY created_at, id
  `.execute(db);
  return result.rows.map((row) => row.change);
}

async function seeded(code: string): Promise<string> {
  const result = await sql<{ id: string }>`
    SELECT id FROM hospitals WHERE code = ${code} AND deleted_at IS NULL
  `.execute(db);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error(`The seed should hold ${code} (FR-DEM-01).`);
  return id;
}

beforeAll(async () => {
  app = createApp();
  const made = await createFirstAdministrator({
    hospitalCode: `F${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`,
    hospital: {
      nameBn: 'মুখচ্ছবি হাসপাতাল (ডেমো)',
      nameEn: 'Face Test Hospital (Demo)',
      kind: 'hospital',
      division: 'Dhaka',
      district: 'Dhaka',
    },
    email: `admin-${randomUUID().slice(0, 8)}@face.demo.invalid`,
    fullName: 'প্রশাসক (ডেমো)',
  });
  hospitalId = made.hospitalId;
  admin = await signToken({
    kind: 'access',
    claims: { sub: made.staffId, kind: 'staff', hospitalId, roles: ['hospital_admin'] },
  });
});

afterAll(async () => {
  // As the owner: the API's role may not delete an audit row (`ownerDb.ts`).
  await asOwner(async (owner) => {
    const run = async (query: ReturnType<typeof sql>): Promise<void> => {
      await query.execute(owner);
    };
    await run(sql`DELETE FROM audit_log WHERE hospital_id = ${hospitalId}::uuid`);
    await run(sql`DELETE FROM staff_roles WHERE hospital_id = ${hospitalId}::uuid`);
    await run(sql`DELETE FROM hospital_logos WHERE hospital_id = ${hospitalId}::uuid`);
    await run(sql`DELETE FROM hospital_settings WHERE hospital_id = ${hospitalId}::uuid`);
    await run(sql`UPDATE hospitals SET created_by = NULL WHERE id = ${hospitalId}::uuid`);
    await run(
      sql`DELETE FROM sessions_auth WHERE subject_id IN (SELECT id FROM staff_users WHERE hospital_id = ${hospitalId}::uuid)`,
    );
    await run(sql`DELETE FROM staff_users WHERE hospital_id = ${hospitalId}::uuid`);
    await run(sql`DELETE FROM hospitals WHERE id = ${hospitalId}::uuid`);
  });
});

describe('what a hospital says of itself (FR-BRD-06)', () => {
  it('is set in both languages, read back, and cleared', async () => {
    await write('patch', '/hospital/profile', admin, {
      descriptionBn: 'একটি পরীক্ষার হাসপাতাল। (ডেমো)',
      descriptionEn: 'A hospital for a test. (Demo)',
    }).expect(200);
    expect((await setup()).hospital).toMatchObject({
      descriptionBn: 'একটি পরীক্ষার হাসপাতাল। (ডেমো)',
      descriptionEn: 'A hospital for a test. (Demo)',
    });

    // One language changed leaves the other as it was; null clears.
    await write('patch', '/hospital/profile', admin, { descriptionEn: null }).expect(200);
    expect((await setup()).hospital).toMatchObject({
      descriptionBn: 'একটি পরীক্ষার হাসপাতাল। (ডেমো)',
      descriptionEn: null,
    });
  });

  it('is short', async () => {
    const response = await write('patch', '/hospital/profile', admin, {
      descriptionEn: 'x'.repeat(401),
    });
    expect(response.status).toBe(400);
  });
});

describe('its colours (FR-BRD-06, FR-BRD-03)', () => {
  it('keeps a set that can carry text, and says so in the audit log', async () => {
    const theme = themeFromColour('#ffd400');
    await write('put', '/hospital/brand', admin, { theme }).expect(200);
    expect((await setup()).face.theme).toEqual(theme);
    expect(await changesRecorded()).toContain('brand');
  });

  it('refuses a set that cannot, says which rule it broke, and keeps what it had', async () => {
    const before = (await setup()).face.theme;
    const pale: BrandTheme = {
      colors: { ...themeFromColour('#17507f').colors, 'brand-600': '#ffe680' },
    };
    expect(brandProblems(pale)).toContain('button_text_unreadable');

    const response = await write('put', '/hospital/brand', admin, { theme: pale });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(response.body.error).toMatchObject({
      code: 'SETTINGS_NOT_ALLOWED',
      details: { reason: 'brand_unreadable' },
    });
    expect(response.body.error.details.problems).toContain('button_text_unreadable');
    expect((await setup()).face.theme).toEqual(before);
  });

  it('refuses anything that is not six colours', async () => {
    await write('put', '/hospital/brand', admin, { theme: { colors: {} } }).expect(400);
    await write('put', '/hospital/brand', admin, {
      theme: {
        colors: { ...themeFromColour('#17507f').colors, 'brand-600': 'url(javascript:1)' },
      },
    }).expect(400);
    await write('put', '/hospital/brand', admin, {}).expect(400);
  });

  it('goes back to the platform’s own', async () => {
    await write('put', '/hospital/brand', admin, { theme: null }).expect(200);
    expect((await setup()).face.theme).toBeNull();
    expect(await changesRecorded()).toContain('brand_cleared');
  });
});

describe('its logo (FR-BRD-06)', () => {
  it('is kept, read back by its own administrator, replaced and removed', async () => {
    const first = png(200);
    const put = await write('put', '/hospital/logo', admin, {
      fileType: 'image/png',
      content: first.toString('base64'),
    });
    expect(put.status).toBe(200);
    const version = (put.body.data as { version: string }).version;
    expect(version).toMatch(/^[0-9a-f]{16}$/);
    expect((await setup()).face.logo).toEqual({ version, contentType: 'image/png', bytes: 200 });

    const own = await request(app)
      .get(`${BASE}/hospital/logo`)
      .set('Authorization', bearer(admin))
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          done(null, Buffer.concat(chunks));
        });
      });
    expect(own.status).toBe(200);
    expect(own.headers['content-type']).toBe('image/png');
    expect(own.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.compare(own.body as Buffer, first)).toBe(0);

    // A second one replaces the first: one logo per hospital, a new version.
    const second = await write('put', '/hospital/logo', admin, {
      fileType: 'image/png',
      content: png(300).toString('base64'),
    });
    expect((second.body.data as { version: string }).version).not.toBe(version);
    expect((await setup()).face.logo?.bytes).toBe(300);

    await write('delete', '/hospital/logo', admin).expect(200);
    expect((await setup()).face.logo).toBeNull();
    await request(app).get(`${BASE}/hospital/logo`).set('Authorization', bearer(admin)).expect(404);
    expect(await changesRecorded()).toEqual(expect.arrayContaining(['logo', 'logo_removed']));
  });

  it('is the image it says it is', async () => {
    const pdf = Buffer.from('%PDF-1.4 not an image at all');
    const response = await write('put', '/hospital/logo', admin, {
      fileType: 'image/png',
      content: pdf.toString('base64'),
    });
    expect(response.status).toBe(400);
    expect(response.body.error.details).toMatchObject({ reason: 'logo_not_that_image' });
    expect((await setup()).face.logo).toBeNull();
  });

  it('is not an SVG, and not larger than a quarter of a megabyte', async () => {
    await write('put', '/hospital/logo', admin, {
      fileType: 'image/svg+xml',
      content: Buffer.from('<svg/>').toString('base64'),
    }).expect(400);

    const large = await write('put', '/hospital/logo', admin, {
      fileType: 'image/png',
      content: png(LOGO_MAX_BYTES + 1).toString('base64'),
    });
    expect(large.status).toBe(400);
    expect((await setup()).face.logo).toBeNull();

    // And one of exactly the ceiling is taken: the limit is the stated one,
    // not whatever the body parser happens to allow.
    const most = await write('put', '/hospital/logo', admin, {
      fileType: 'image/png',
      content: png(LOGO_MAX_BYTES).toString('base64'),
    });
    expect(most.status).toBe(200);
    await write('delete', '/hospital/logo', admin).expect(200);
  });

  it('is not public while the hospital is not in the network (FR-NET-03)', async () => {
    await write('put', '/hospital/logo', admin, {
      fileType: 'image/png',
      content: png().toString('base64'),
    }).expect(200);
    await request(app).get(`${BASE}/hospitals/${hospitalId}/logo`).expect(404);
    await write('delete', '/hospital/logo', admin).expect(200);
  });
});

describe('who may change it (FR-ROLE-01)', () => {
  const routes: readonly (readonly ['put' | 'delete', string, object])[] = [
    ['put', '/hospital/brand', { theme: null }],
    ['put', '/hospital/logo', { fileType: 'image/png', content: png().toString('base64') }],
    ['delete', '/hospital/logo', {}],
  ];

  it.each(routes)('%s %s: an administrator only', async (method, path, body) => {
    for (const role of [
      'receptionist',
      'doctor',
      'ward',
      'emergency',
      'lab',
      'pharmacy',
    ] as const) {
      const response = await write(method, path, await staffToken([role], hospitalId), body);
      expect(response.status, role).toBe(403);
    }
    expect((await write(method, path, await nationalToken(['platform_admin']), body)).status).toBe(
      403,
    );
    expect((await write(method, path, await patientToken(), body)).status).toBe(403);
    expect((await write(method, path, null, body)).status).toBe(401);
  });

  it('GET /hospital/logo: an administrator only', async () => {
    const read = async (token: string | null): Promise<number> => {
      const pending = request(app).get(`${BASE}/hospital/logo`);
      return (await (token === null ? pending : pending.set('Authorization', bearer(token))))
        .status;
    };
    expect(await read(await staffToken(['receptionist'], hospitalId))).toBe(403);
    expect(await read(await nationalToken(['platform_admin']))).toBe(403);
    expect(await read(null)).toBe(401);
  });
});

describe('what the public is shown (FR-BRD-06, FR-NET-01)', () => {
  it('a hospital’s card carries what it says of itself and which logo it has', async () => {
    const padma = await seeded('PADMA');
    const shapla = await seeded('SHAPLA');

    const one = await request(app).get(`${BASE}/hospitals/${padma}`).expect(200);
    const card = one.body.data.hospital as {
      descriptionBn: string | null;
      descriptionEn: string | null;
      logoVersion: string | null;
    };
    expect(card.descriptionEn).toContain('demonstration data');
    expect(card.descriptionBn).toContain('প্রদর্শনীর');
    expect(card.logoVersion).toMatch(/^[0-9a-f]{16}$/);

    const listed = await request(app).get(`${BASE}/hospitals?limit=100`).expect(200);
    const cards = listed.body.data.hospitals as { id: string; logoVersion: string | null }[];
    expect(cards.find((entry) => entry.id === padma)?.logoVersion).toBe(card.logoVersion);
    // A hospital that has set none says so with nothing, not with a broken image.
    expect(cards.find((entry) => entry.id === shapla)?.logoVersion).toBeNull();
  });

  it('its portal is told the same (GET /config?scope=)', async () => {
    const response = await request(app).get(`${BASE}/config?scope=PADMA`).expect(200);
    const scope = response.body.data.scope as {
      descriptionEn: string | null;
      logoVersion: string | null;
    };
    expect(scope.descriptionEn).toContain('Uttara');
    expect(scope.logoVersion).toMatch(/^[0-9a-f]{16}$/);
  });

  it('the logo is served to anybody, from any origin, and kept by a phone while it is current', async () => {
    const padma = await seeded('PADMA');
    const card = await request(app).get(`${BASE}/hospitals/${padma}`).expect(200);
    const version = (card.body.data.hospital as { logoVersion: string }).logoVersion;

    const current = await request(app).get(`${BASE}/hospitals/${padma}/logo?v=${version}`);
    expect(current.status).toBe(200);
    expect(current.headers['content-type']).toBe('image/png');
    expect(current.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(current.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(current.headers['x-content-type-options']).toBe('nosniff');
    expect((current.body as Buffer).subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    // An address without the current version is not kept for a year.
    const bare = await request(app).get(`${BASE}/hospitals/${padma}/logo`);
    expect(bare.headers['cache-control']).toBe('public, max-age=300');
    const stale = await request(app).get(`${BASE}/hospitals/${padma}/logo?v=0000000000000000`);
    expect(stale.headers['cache-control']).toBe('public, max-age=300');
  });

  it('a hospital with no logo has no logo', async () => {
    await request(app)
      .get(`${BASE}/hospitals/${await seeded('SHAPLA')}/logo`)
      .expect(404);
    await request(app).get(`${BASE}/hospitals/${randomUUID()}/logo`).expect(404);
  });
});
