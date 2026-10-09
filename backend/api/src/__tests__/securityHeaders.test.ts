/**
 * The headers every answer from the API carries (plan A7; `NFR-08`; handover
 * finding 22). `middleware/securityHeaders.ts` says what each is for.
 */

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { securityHeaders } from '../middleware/securityHeaders.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;

beforeEach(() => {
  app = createApp();
});

function expectHardened(headers: Record<string, string | string[] | undefined>): void {
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['content-security-policy']).toContain("default-src 'none'");
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['permissions-policy']).toContain('geolocation=()');
  // And nothing that says what the server is built with.
  expect(headers['x-powered-by']).toBeUndefined();
}

describe('every answer carries them', () => {
  it('a public read', async () => {
    const response = await request(app).get(`${BASE}/hospitals`);
    expect(response.status).toBe(200);
    expectHardened(response.headers);
  });

  it('a refusal', async () => {
    const response = await request(app).get(`${BASE}/staff/me`);
    expect(response.status).toBe(401);
    expectHardened(response.headers);
  });

  it('a path that does not exist', async () => {
    const response = await request(app).get(`${BASE}/no-such-thing`);
    expect(response.status).toBe(404);
    expectHardened(response.headers);
  });

  it('the health check, outside the API’s own path', async () => {
    const response = await request(app).get('/healthz');
    expectHardened(response.headers);
  });
});

describe('nothing is left in a shared computer’s cache unless a route says so', () => {
  it('answers no-store by default', async () => {
    const response = await request(app).get(`${BASE}/hospitals`);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('a link with a patient behind it is not cached either, though it carries no token header', async () => {
    const response = await request(app).get(
      `${BASE}/guest/link/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
    );
    expect(response.status).toBe(410);
    expect(response.headers['cache-control']).toBe('no-store');
  });
});

describe('Strict-Transport-Security follows the connection', () => {
  it('is not sent over plain HTTP, where it means nothing', async () => {
    const response = await request(app).get('/healthz');
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });
});

describe('the middleware itself', () => {
  function run(secure: boolean): Map<string, string> {
    const sent = new Map<string, string>();
    let went = false;
    securityHeaders(
      { secure } as never,
      {
        setHeader: (name: string, value: string) => {
          sent.set(name.toLowerCase(), value);
        },
      } as never,
      () => {
        went = true;
      },
    );
    expect(went).toBe(true);
    return sent;
  }

  it('sends Strict-Transport-Security on an answer that went out over HTTPS', () => {
    expect(run(true).get('strict-transport-security')).toBe('max-age=15552000; includeSubDomains');
  });

  it('and not otherwise', () => {
    expect(run(false).has('strict-transport-security')).toBe(false);
  });
});
