/**
 * A hospital's portal has an address (`PRD.md` `FR-BRD-07`, `FR-BRD-04`;
 * plan C2; migration 0046; `services/portal.service.ts`).
 *
 * Opened at `<code>.<platform domain>`, or at a domain a platform
 * administrator has recorded for a hospital, the patient app is that
 * hospital's with nothing in the address to say so. The API answers for those
 * addresses and no others, and a link issued inside a portal opens in it.
 *
 * The deployment under test is given a platform domain for the length of
 * this file; every other suite runs with none, which is the ordinary state
 * of the demonstration.
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';
import { patientLink } from '../config/links.js';
import { runWithPatientOrigin } from '../config/requestOrigin.js';
import { env } from '../env.js';
import * as demoRepo from '../repositories/demo.repo.js';
import * as portals from '../services/portal.service.js';

import { asOwner } from './support/ownerDb.js';
import { createQueueFixture } from './support/queueFixture.js';
import { bearer, nationalToken, staffToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';
const DOMAIN = 'medlivebd.example';
const OWN = 'portal.padma-hospital.example';

const mutable = env as { PLATFORM_DOMAIN: string };
const before = mutable.PLATFORM_DOMAIN;

let app: Express;
let platform: string;
let padma: string;
let shapla: string;

async function seeded(code: string): Promise<string> {
  const result = await sql<{ id: string }>`
    SELECT id FROM hospitals WHERE code = ${code} AND deleted_at IS NULL
  `.execute(db);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error(`The seed should hold ${code} (FR-DEM-01).`);
  return id;
}

async function scopeAt(query: string): Promise<request.Response> {
  return await request(app).get(`${BASE}/config?${query}`);
}

async function record(
  hospitalId: string,
  domain: string | null,
  token: string | null = platform,
): Promise<request.Response> {
  const pending = request(app)
    .post(`${BASE}/platform/hospitals/${hospitalId}/domain`)
    .set('Idempotency-Key', randomUUID());
  return await (token === null ? pending : pending.set('Authorization', bearer(token))).send({
    domain,
  });
}

/** As the seed left it: no hospital has a domain of its own. */
async function forgetDomains(): Promise<void> {
  await asOwner(async (owner) => {
    await sql`UPDATE hospitals SET portal_domain = NULL WHERE portal_domain IS NOT NULL`.execute(
      owner,
    );
  });
  portals.forgetRecordedDomains();
}

beforeAll(async () => {
  app = createApp();
  mutable.PLATFORM_DOMAIN = DOMAIN;
  padma = await seeded('PADMA');
  shapla = await seeded('SHAPLA');

  const account = await demoRepo.nationalStaffFor('platform_admin');
  if (account === null) throw new Error('The seed has no platform administrator.');
  platform = await signToken({
    kind: 'access',
    claims: { sub: account.id, kind: 'staff', roles: ['platform_admin'] },
  });
});

afterEach(async () => {
  mutable.PLATFORM_DOMAIN = DOMAIN;
  await forgetDomains();
});

afterAll(async () => {
  mutable.PLATFORM_DOMAIN = before;
  await forgetDomains();
  await asOwner(async (owner) => {
    await sql`
      DELETE FROM audit_log
       WHERE action = 'SETTINGS_CHANGE'
         AND meta ->> 'change' IN ('portal_domain', 'portal_domain_removed')
    `.execute(owner);
  });
});

describe('whose portal an address is (FR-BRD-07)', () => {
  it('a hospital’s code in front of the platform’s domain is that hospital’s, with no parameter', async () => {
    const response = await scopeAt(`host=padma.${DOMAIN}`);
    expect(response.status).toBe(200);
    expect(response.body.data.scope).toMatchObject({
      code: 'PADMA',
      hospitalId: padma,
      byAddress: true,
    });
  });

  it('the platform’s own address, and a machine’s, are the network', async () => {
    for (const host of [DOMAIN, `www.${DOMAIN}`, `api.${DOMAIN}`, 'localhost:3000', '127.0.0.1']) {
      const response = await scopeAt(`host=${host}`);
      expect(response.status, host).toBe(200);
      expect(response.body.data.scope, host).toBeNull();
    }
  });

  it('at a portal, the address decides: a scope beside it does not make it another hospital’s', async () => {
    const response = await scopeAt(`host=padma.${DOMAIN}&scope=SHAPLA`);
    expect(response.body.data.scope).toMatchObject({ code: 'PADMA', byAddress: true });
  });

  it('at the network’s address a scope still opens a hospital, as it always has (FR-BRD-02)', async () => {
    const response = await scopeAt(`host=${DOMAIN}&scope=SHAPLA`);
    expect(response.body.data.scope).toMatchObject({ code: 'SHAPLA', byAddress: false });
  });

  it('a code nobody has is nobody’s portal, said as a 404', async () => {
    expect((await scopeAt(`host=nosuch.${DOMAIN}`)).status).toBe(404);
  });

  it('a name nobody has recorded is nobody’s, said so, with where the network is', async () => {
    const response = await scopeAt('host=portal.some-other.example');
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      scope: null,
      address: 'nobodys',
      networkUrl: env.WEB_BASE_URL,
    });
  });

  it('says which of the three an address is', async () => {
    expect((await scopeAt(`host=${DOMAIN}`)).body.data.address).toBe('network');
    expect((await scopeAt(`host=padma.${DOMAIN}`)).body.data.address).toBe('portal');
    expect((await scopeAt('scope=PADMA')).body.data.address).toBe('network');
    // Wherever the deployment serves the patient app is the network's, under
    // the platform's domain or not.
    const web = new URL(env.WEB_BASE_URL).host;
    expect((await scopeAt(`host=${web}`)).body.data).toMatchObject({ address: 'network' });
    expect((await scopeAt(`host=${DOMAIN}`)).body.data.networkUrl).toBeUndefined();
  });

  it('with no platform domain, every address is the network', async () => {
    mutable.PLATFORM_DOMAIN = '';
    const response = await scopeAt(`host=padma.${DOMAIN}`);
    expect(response.status).toBe(200);
    expect(response.body.data.scope).toBeNull();
  });
});

describe('a domain the hospital owns, recorded by the platform (FR-BRD-07)', () => {
  it('is that hospital’s portal from the next request, and stops being when it is removed', async () => {
    const recorded = await record(padma, ` ${OWN.toUpperCase()} `);
    expect(recorded.status).toBe(200);
    expect(recorded.body.data).toMatchObject({
      portalDomain: OWN,
      portal: { own: `https://${OWN}`, platform: `http://padma.${DOMAIN}:3000` },
    });

    const at = await scopeAt(`host=${OWN}`);
    expect(at.body.data.scope).toMatchObject({ code: 'PADMA', byAddress: true });

    // The hospital sees where its portal is on its own settings screen.
    const adminId = (
      await sql<{ staff_user_id: string }>`
        SELECT staff_user_id FROM staff_roles
         WHERE hospital_id = ${padma}::uuid AND role = 'hospital_admin' AND deleted_at IS NULL
         LIMIT 1
      `.execute(db)
    ).rows[0]?.staff_user_id;
    const setup = await request(app)
      .get(`${BASE}/hospital/setup`)
      .set(
        'Authorization',
        bearer(
          await signToken({
            kind: 'access',
            claims: {
              sub: adminId ?? '',
              kind: 'staff',
              hospitalId: padma,
              roles: ['hospital_admin'],
            },
          }),
        ),
      );
    expect(setup.body.data.portal).toEqual({
      own: `https://${OWN}`,
      platform: `http://padma.${DOMAIN}:3000`,
    });

    const removed = await record(padma, null);
    expect(removed.body.data).toMatchObject({ portalDomain: null, portal: { own: null } });
    expect((await scopeAt(`host=${OWN}`)).body.data.scope).toBeNull();
  });

  it('is one hospital’s and no other’s', async () => {
    expect((await record(padma, OWN)).status).toBe(200);
    const second = await record(shapla, OWN);
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(second.status).toBeLessThan(500);
    expect(second.body.error.details).toMatchObject({ reason: 'domain_taken' });
    // Recording it again for the hospital that has it changes nothing and is not refused.
    expect((await record(padma, OWN)).status).toBe(200);
  });

  it('is never a name under the platform’s own domain', async () => {
    for (const domain of [DOMAIN, `shapla.${DOMAIN}`, `anything.at.all.${DOMAIN}`]) {
      const response = await record(padma, domain);
      expect(response.body.error?.details, domain).toMatchObject({
        reason: 'domain_is_the_platforms',
      });
    }
  });

  it('is a domain name and nothing else', async () => {
    for (const domain of [
      'https://portal.example.com',
      'portal.example.com/path',
      'portal.example.com:8443',
      'localhost',
      '10.1.2.3',
      'nodot',
    ]) {
      expect((await record(padma, domain)).status, domain).toBe(400);
    }
  });

  it('is the platform administrator’s to record, and nobody else’s', async () => {
    expect((await record(padma, OWN, await staffToken(['hospital_admin'], padma))).status).toBe(
      403,
    );
    expect((await record(padma, OWN, await nationalToken(['gov_viewer']))).status).toBe(403);
    expect((await record(padma, OWN, null)).status).toBe(401);
    expect((await record(randomUUID(), OWN)).status).toBe(404);
    expect((await scopeAt(`host=${OWN}`)).body.data.scope).toBeNull();
  });

  it('is written to the audit log', async () => {
    await record(padma, OWN);
    await record(padma, null);
    const rows = await sql<{ change: string }>`
      SELECT meta ->> 'change' AS change FROM audit_log
       WHERE hospital_id = ${padma}::uuid AND action = 'SETTINGS_CHANGE'
         AND meta ->> 'change' IN ('portal_domain', 'portal_domain_removed')
       ORDER BY created_at, id
    `.execute(db);
    expect(rows.rows.map((row) => row.change).slice(-2)).toEqual([
      'portal_domain',
      'portal_domain_removed',
    ]);
  });
});

describe('the addresses this API answers a browser at (FR-BRD-04, FR-BRD-07)', () => {
  const allowed = async (origin: string): Promise<string | undefined> =>
    (await request(app).get(`${BASE}/hospitals`).set('Origin', origin)).headers[
      'access-control-allow-origin'
    ];

  it('a hospital’s portal under the platform’s domain', async () => {
    const origin = `https://padma.${DOMAIN}`;
    expect(await allowed(origin)).toBe(origin);

    const preflight = await request(app)
      .options(`${BASE}/bookings`)
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(origin);
    expect(preflight.headers['access-control-allow-methods']).toContain('POST');
  });

  it('not a name that only looks like the platform’s', async () => {
    for (const origin of [
      `https://evil${DOMAIN}`,
      `https://${DOMAIN}.attacker.example`,
      `https://padma.${DOMAIN}.attacker.example`,
      `https://a.padma.${DOMAIN}`,
      'https://portal.some-other.example',
      'null',
    ]) {
      expect(await allowed(origin), origin).toBeUndefined();
    }
  });

  it('a hospital’s own domain, once it is recorded and until it is removed', async () => {
    const origin = `https://${OWN}`;
    expect(await allowed(origin)).toBeUndefined();
    await record(padma, OWN);
    expect(await allowed(origin)).toBe(origin);
    await record(padma, null);
    expect(await allowed(origin)).toBeUndefined();
  });

  it('whose address this is may be asked from anywhere, and nothing else may', async () => {
    const stranger = 'https://portal.some-other.example';
    const config = await request(app)
      .get(`${BASE}/config?host=portal.some-other.example`)
      .set('Origin', stranger);
    // Readable, without credentials: the answer is public.
    expect(config.headers['access-control-allow-origin']).toBe('*');
    expect(config.headers['access-control-allow-credentials']).toBeUndefined();
    expect(config.body.data.address).toBe('nobodys');

    // And the question a browser puts before it, since the app's client sends
    // a content type: to read, and nothing more.
    const asked = await request(app)
      .options(`${BASE}/config`)
      .set('Origin', stranger)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'content-type');
    expect(asked.status).toBe(204);
    expect(asked.headers['access-control-allow-origin']).toBe('*');
    expect(asked.headers['access-control-allow-methods']).toBe('GET');
    expect(asked.headers['access-control-allow-credentials']).toBeUndefined();

    for (const path of ['/hospitals', '/search', '/doctors', '/sessions']) {
      const response = await request(app).get(`${BASE}${path}`).set('Origin', stranger);
      expect(response.headers['access-control-allow-origin'], path).toBeUndefined();
    }
    const write = await request(app)
      .options(`${BASE}/bookings`)
      .set('Origin', stranger)
      .set('Access-Control-Request-Method', 'POST');
    expect(write.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('the socket handshake is asked the same question', async () => {
    expect(await portals.originAllowed(`https://padma.${DOMAIN}`)).toBe(true);
    expect(await portals.originAllowed(env.WEB_BASE_URL)).toBe(true);
    expect(await portals.originAllowed(env.CONSOLE_BASE_URL)).toBe(true);
    expect(await portals.originAllowed(`https://evil${DOMAIN}`)).toBe(false);
    expect(await portals.originAllowed(`https://${OWN}`)).toBe(false);
  });

  it('with no platform domain, only the fixed list is answered', async () => {
    mutable.PLATFORM_DOMAIN = '';
    expect(await allowed(`https://padma.${DOMAIN}`)).toBeUndefined();
    expect(await allowed(env.WEB_BASE_URL)).toBe(env.WEB_BASE_URL);
  });
});

describe('a link opens where the patient is (FR-BRD-04)', () => {
  const guest = (): Record<string, unknown> => ({
    name: 'রহিমা খাতুন (ডেমো)',
    phone: `+88019${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`,
    ageYears: 34,
    sex: 'female',
  });

  async function book(origin: string | null): Promise<URL> {
    const fixture = await createQueueFixture(1);
    const pending = request(app).post(`${BASE}/bookings`).set('Idempotency-Key', randomUUID());
    const response = await (origin === null ? pending : pending.set('Origin', origin)).send({
      sessionId: fixture.sessionId,
      method: 'at_hospital',
      guest: guest(),
    });
    expect(response.status, JSON.stringify(response.body).slice(0, 200)).toBe(201);
    return new URL(response.body.data.trackingUrl as string);
  }

  it('booked inside a hospital’s portal, the serial’s link is that portal’s', async () => {
    const link = await book(`https://padma.${DOMAIN}`);
    expect(link.origin).toBe(`https://padma.${DOMAIN}`);
    expect(link.pathname).toBe('/s');
    expect(link.searchParams.get('t')).toBeTruthy();
  });

  it('booked in the network’s app, it is the network’s', async () => {
    expect((await book(env.WEB_BASE_URL)).origin).toBe(new URL(env.WEB_BASE_URL).origin);
  });

  it('an address this deployment does not answer for is never put in a link', async () => {
    expect((await book(`https://evil${DOMAIN}`)).origin).toBe(new URL(env.WEB_BASE_URL).origin);
    expect((await book(env.CONSOLE_BASE_URL)).origin).toBe(new URL(env.WEB_BASE_URL).origin);
  });

  it('with no patient behind the request, it goes to the hospital’s own domain if it has one', async () => {
    expect(await portals.hospitalLinkOrigin(padma)).toBeNull();
    await record(padma, OWN);
    expect(await portals.hospitalLinkOrigin(padma)).toBe(`https://${OWN}`);
    expect(await portals.hospitalLinkOrigin(shapla)).toBeNull();

    expect(patientLink('/s', { t: 'x' }, { hospitalOrigin: `https://${OWN}` })).toBe(
      `https://${OWN}/s?t=x`,
    );
    // Where the patient is comes first: the network's app stays the network's.
    runWithPatientOrigin(env.WEB_BASE_URL, () => {
      expect(patientLink('/s', { t: 'x' }, { hospitalOrigin: `https://${OWN}` })).toBe(
        `${new URL(env.WEB_BASE_URL).origin}/s?t=x`,
      );
    });
  });
});
