/**
 * Hospital scope, patient links and allowed origins (`FR-BRD-01`–`04`,
 * `FR-PAT-19`).
 *
 * The foundation a hospital-branded patient app stands on, and no more than
 * that: discovery narrowed to one hospital by its code, `GET /config` saying
 * whose app it is and in which colours, one builder for links, one list of
 * origins. Runs against the seeded demo database (CLAUDE.md §6), where Padma
 * has colours of its own and no other facility does.
 */

import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { brandProblems, type BrandTheme } from '@platform/domain';

import { createApp } from '../app.js';
import { allowedOrigins, patientLink } from '../config/links.js';
import { EnvError, env, loadEnv } from '../env.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;

beforeAll(() => {
  app = createApp();
});

describe('GET /config says whose app it is (FR-BRD-02, FR-PAT-19)', () => {
  it('is nobody’s for the network’s own app', async () => {
    const response = await request(app).get(`${BASE}/config`);

    expect(response.status).toBe(200);
    expect(response.body.data.scope).toBeNull();
    // What it always answered is still there.
    expect(typeof response.body.data.demo).toBe('boolean');
    expect(typeof response.body.data.onlinePayments).toBe('boolean');
  });

  it('names the hospital for a scope, whatever the case of the code', async () => {
    const response = await request(app).get(`${BASE}/config?scope=padma`);

    expect(response.status).toBe(200);
    expect(response.body.data.scope).toMatchObject({ code: 'PADMA' });
    expect(response.body.data.scope.nameEn).toMatch(/^Padma/);
    expect(response.body.data.scope.nameBn).toContain('পদ্মা');
  });

  it('carries the hospital’s colours when it has set readable ones (FR-BRD-03)', async () => {
    const response = await request(app).get(`${BASE}/config?scope=PADMA`);
    const theme = response.body.data.scope.theme as BrandTheme;

    expect(theme.colors['brand-600']).toBe('#17507f');
    // The seeded theme is held to the rule every theme is.
    expect(brandProblems(theme)).toEqual([]);
  });

  it('carries none for a hospital that has set none', async () => {
    const response = await request(app).get(`${BASE}/config?scope=SHAPLA`);
    expect(response.body.data.scope).toMatchObject({ code: 'SHAPLA', theme: null });
  });

  it('refuses a code it does not know rather than answering for the whole network', async () => {
    // An app built for one hospital must not become every hospital's because
    // of a mistake in its configuration.
    const response = await request(app).get(`${BASE}/config?scope=NOSUCH`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('refuses a malformed code', async () => {
    expect((await request(app).get(`${BASE}/config?scope=a`)).status).toBe(400);
    expect((await request(app).get(`${BASE}/config?scope=pad%20ma`)).status).toBe(400);
  });
});

describe('discovery in scope is one hospital’s (FR-BRD-02)', () => {
  it('lists that hospital and no other', async () => {
    const response = await request(app).get(`${BASE}/hospitals?scope=PADMA`);
    const names = (response.body.data.hospitals as { nameEn: string }[]).map((h) => h.nameEn);

    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^Padma/);
  });

  it('answers a need for that hospital only', async () => {
    const network = await request(app).get(`${BASE}/search?need=bed:icu`);
    const scoped = await request(app).get(`${BASE}/search?need=bed:icu&scope=PADMA`);

    expect(network.body.data.hospitals.length).toBeGreaterThan(1);
    const names = (scoped.body.data.hospitals as { nameEn: string }[]).map((h) => h.nameEn);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^Padma/);
  });

  it('lists a doctor’s chamber there, and not the same doctor’s chamber elsewhere', async () => {
    const scoped = await request(app).get(`${BASE}/search?need=specialty:CARD&scope=PADMA`);
    const padmaId = (scoped.body.data.hospitals as { id: string }[])[0]?.id;

    expect(padmaId).toBeDefined();
    const doctors = scoped.body.data.doctors as {
      chambers: { hospitalId: string }[];
    }[];
    expect(doctors.length).toBeGreaterThan(0);
    for (const doctor of doctors) {
      expect(doctor.chambers.length).toBeGreaterThan(0);
      expect(doctor.chambers.every((chamber) => chamber.hospitalId === padmaId)).toBe(true);
    }
  });

  it('does not find another hospital by name', async () => {
    const response = await request(app).get(`${BASE}/search?q=shapla&scope=PADMA`);
    expect(response.body.data.hospitals).toEqual([]);
  });

  it('narrows the doctor list the same way', async () => {
    const response = await request(app).get(`${BASE}/doctors?scope=PADMA`);
    const doctors = response.body.data.doctors as { chambers: { hospitalNameEn: string }[] }[];

    expect(doctors.length).toBeGreaterThan(0);
    for (const doctor of doctors) {
      expect(doctor.chambers.some((chamber) => chamber.hospitalNameEn.startsWith('Padma'))).toBe(
        true,
      );
    }
  });

  it('refuses an unknown scope on every one of them', async () => {
    for (const path of ['/hospitals', '/doctors', '/search']) {
      const response = await request(app).get(`${BASE}${path}?scope=NOSUCH`);
      expect(response.status, path).toBe(404);
    }
  });
});

describe('patient links are built in one place (FR-BRD-04)', () => {
  it('builds on the patient app’s address, with its query encoded', () => {
    expect(patientLink('/s', { b: 'booking-1', t: 'a b&c' })).toBe(
      `${env.WEB_BASE_URL}/s?b=booking-1&t=a+b%26c`,
    );
    expect(patientLink('/standby')).toBe(`${env.WEB_BASE_URL}/standby`);
  });

  it('accepts a hospital and, until hospitals have addresses, answers the same', () => {
    expect(patientLink('/s', { t: 'x' }, { hospitalCode: 'PADMA' })).toBe(
      patientLink('/s', { t: 'x' }),
    );
  });
});

describe('the origins this API answers (FR-BRD-04)', () => {
  const mutable = env as { EXTRA_ALLOWED_ORIGINS: readonly string[] };
  const before = mutable.EXTRA_ALLOWED_ORIGINS;

  afterEach(() => {
    mutable.EXTRA_ALLOWED_ORIGINS = before;
  });

  it('is the patient app and the console, and nothing else, by default', () => {
    expect(allowedOrigins()).toEqual([env.WEB_BASE_URL, env.CONSOLE_BASE_URL]);
  });

  it('answers an origin that has been added, and still refuses one that has not', async () => {
    mutable.EXTRA_ALLOWED_ORIGINS = ['https://padma.example.org'];

    const added = await request(app)
      .get(`${BASE}/config`)
      .set('Origin', 'https://padma.example.org');
    expect(added.status).toBe(200);
    expect(added.headers['access-control-allow-origin']).toBe('https://padma.example.org');

    const stranger = await request(app)
      .get(`${BASE}/config`)
      .set('Origin', 'https://padma.example.org.evil.test');
    // Refused the way this API refuses an origin: no CORS headers, so the
    // browser discards the answer (`middleware/cors.ts`).
    expect(stranger.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('reads a comma-separated list of exact origins from the environment', () => {
    const DEV = {
      NODE_ENV: 'development',
      API_BASE_URL: 'http://localhost:4000',
      WEB_BASE_URL: 'http://localhost:3000',
      DATABASE_URL: 'postgresql://healthcare:healthcare@localhost:5432/healthcare_dev',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
      GUEST_LINK_SECRET: 'c'.repeat(32),
    };

    expect(loadEnv({ ...DEV }).EXTRA_ALLOWED_ORIGINS).toEqual([]);
    expect(
      loadEnv({ ...DEV, EXTRA_ALLOWED_ORIGINS: 'https://a.example.org, https://b.example.org' })
        .EXTRA_ALLOWED_ORIGINS,
    ).toEqual(['https://a.example.org', 'https://b.example.org']);

    // A path, a trailing slash or a pattern is not an origin.
    for (const wrong of ['https://a.example.org/', 'https://a.example.org/app', '*.example.org']) {
      expect(() => loadEnv({ ...DEV, EXTRA_ALLOWED_ORIGINS: wrong }), wrong).toThrow(EnvError);
    }
  });
});
