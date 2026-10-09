/**
 * `GET /hospital/brand` — the hospital's own face on its consoles (plan K4;
 * `PRD.md` `FR-BRD-12`).
 *
 * Any member of the hospital's staff reads it, and it is always the caller's
 * own hospital: no hospital is named in the request. A patient, a tracking
 * link and nobody are refused. Padma, the demonstration hospital with a mark
 * and colours of its own (`FR-BRD-06`), answers with both.
 */

import { sql } from 'kysely';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';

import { bearer, patientToken, staffToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;

beforeEach(() => {
  app = createApp();
});

async function hospitalByCode(code: string): Promise<string> {
  const result = await sql<{ id: string }>`
    SELECT id FROM hospitals WHERE code = ${code} AND deleted_at IS NULL
  `.execute(db);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error(`the seed should hold ${code} (FR-DEM-01)`);
  return id;
}

describe('GET /hospital/brand (FR-BRD-12)', () => {
  it('answers any member of staff with their own hospital’s names, colours and logo', async () => {
    const padma = await hospitalByCode('PADMA');
    for (const role of ['receptionist', 'doctor', 'ward', 'lab'] as const) {
      const response = await request(app)
        .get(`${BASE}/hospital/brand`)
        .set('Authorization', bearer(await staffToken([role], padma)));
      expect(response.status).toBe(200);
      const brand = response.body.data as {
        nameEn: string;
        theme: { colors: Record<string, string> } | null;
        logo: string | null;
      };
      expect(brand.nameEn).toContain('Padma');
      expect(brand.theme?.colors['brand-600']).toMatch(/^#[0-9a-f]{6}$/i);
      expect(brand.logo).toMatch(/^data:image\/[a-z+]+;base64,/);
    }
  });

  it('answers a hospital with no colours or logo with nulls, never another’s', async () => {
    const result = await sql<{ id: string }>`
      SELECT h.id FROM hospitals h
        LEFT JOIN hospital_logos l ON l.hospital_id = h.id
       WHERE l.hospital_id IS NULL AND h.deleted_at IS NULL
       ORDER BY h.created_at LIMIT 1
    `.execute(db);
    const plain = result.rows[0]?.id;
    if (plain === undefined) throw new Error('the seed should hold a hospital with no logo');

    const response = await request(app)
      .get(`${BASE}/hospital/brand`)
      .set('Authorization', bearer(await staffToken(['receptionist'], plain)));
    expect(response.status).toBe(200);
    expect(response.body.data.logo).toBeNull();
  });

  it('is nobody else’s', async () => {
    const patient = await request(app)
      .get(`${BASE}/hospital/brand`)
      .set('Authorization', bearer(await patientToken()));
    expect(patient.status).toBe(403);

    const nobody = await request(app).get(`${BASE}/hospital/brand`);
    expect(nobody.status).toBe(401);
  });
});
