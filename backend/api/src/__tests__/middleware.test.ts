/**
 * The middleware that is not about identity: validation, idempotency, rate
 * limiting, and what the logger refuses to record.
 */

import express, { json, type Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { redactedPaths } from '../config/logger.js';
import { errorHandler } from '../middleware/error.js';
import { idempotency, isUnsafeMethod } from '../middleware/idempotency.js';
import { byIp, byPhone, counter, rateLimit } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';

/** An app with one route, for exercising a single middleware. */
function harness(build: (app: Express) => void): Express {
  const app = express();
  app.use(json());
  build(app);
  app.use(errorHandler);
  return app;
}

describe('validate', () => {
  const bookingBody = z.object({
    sessionId: z.uuid(),
    serial: z.coerce.number().int().positive(),
    note: z.string().max(200).optional(),
  });

  const app = harness((a) => {
    a.post('/book', validate({ body: bookingBody }), (req, res) => {
      res.json({ ok: true, data: req.body });
    });
    a.get(
      '/search',
      validate({
        query: z.object({ district: z.string().min(1), limit: z.coerce.number().default(20) }),
      }),
      (req, res) => {
        res.json({ ok: true, data: req.query });
      },
    );
  });

  it('accepts a valid body and hands the handler parsed data', async () => {
    const response = await request(app)
      .post('/book')
      .send({ sessionId: '11111111-1111-7111-8111-111111111111', serial: '18' });

    expect(response.status).toBe(200);
    // Coerced, so a handler never has to parse a string itself.
    expect(response.body.data.serial).toBe(18);
  });

  it('strips a field the schema does not declare', async () => {
    // An unexpected field must not reach a repository and become a column.
    const response = await request(app).post('/book').send({
      sessionId: '11111111-1111-7111-8111-111111111111',
      serial: 4,
      isAdmin: true,
    });

    expect(response.body.data).not.toHaveProperty('isAdmin');
  });

  it('reports every problem at once', async () => {
    // A booking form with three bad fields should not take three round trips.
    const response = await request(app).post('/book').send({ sessionId: 'nope', serial: -1 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.details.issues.length).toBeGreaterThanOrEqual(2);
  });

  it('names the part of the request each problem is in', async () => {
    const response = await request(app).post('/book').send({ serial: 1 });

    expect(response.body.error.details.issues[0].path).toMatch(/^body\./);
  });

  it('validates and coerces the query string', async () => {
    const response = await request(app).get('/search?district=Dhaka&limit=5');

    expect(response.body.data).toEqual({ district: 'Dhaka', limit: 5 });
  });

  it('applies a default from the schema', async () => {
    const response = await request(app).get('/search?district=Dhaka');
    expect(response.body.data.limit).toBe(20);
  });
});

describe('idempotency (FR-PAY-06, FR-QUE-51)', () => {
  const required = harness((a) => {
    a.post('/pay', idempotency({ required: true }), (req, res) => {
      res.json({ ok: true, data: { key: req.idempotencyKey } });
    });
    a.get('/read', idempotency({ required: true }), (_req, res) => {
      res.json({ ok: true, data: null });
    });
  });

  const optional = harness((a) => {
    a.post('/login', idempotency(), (req, res) => {
      res.json({ ok: true, data: { key: req.idempotencyKey ?? null } });
    });
  });

  it('attaches a valid key', async () => {
    const response = await request(required)
      .post('/pay')
      .set('idempotency-key', '0192f2c0-1111-7000-8000-000000000001');

    expect(response.status).toBe(200);
    expect(response.body.data.key).toBe('0192f2c0-1111-7000-8000-000000000001');
  });

  it('refuses a write with no key where one is required', async () => {
    const response = await request(required).post('/pay');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(response.body.error.details.header).toBe('Idempotency-Key');
  });

  it('does not ask a read for a key', async () => {
    expect((await request(required).get('/read')).status).toBe(200);
  });

  it.each([
    ['too short', 'abc'],
    ['illegal characters', 'key with spaces!!'],
    ['too long', 'x'.repeat(200)],
  ])('refuses a key that is %s', async (_label, key) => {
    const response = await request(required).post('/pay').set('idempotency-key', key);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('lets an optional endpoint through without a key, but honours one', async () => {
    expect((await request(optional).post('/login')).body.data.key).toBeNull();

    const withKey = await request(optional)
      .post('/login')
      .set('idempotency-key', 'abcdefghijklmnop');
    expect(withKey.body.data.key).toBe('abcdefghijklmnop');
  });

  it('knows which methods change state', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) {
      expect(isUnsafeMethod(method), method).toBe(true);
    }
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(isUnsafeMethod(method), method).toBe(false);
    }
  });
});

describe('rate limiting (FR-SEC-05, FR-GST-14)', () => {
  beforeEach(() => {
    counter.reset();
  });

  const app = harness((a) => {
    a.post(
      '/otp',
      rateLimit({ limit: 3, windowSeconds: 600, keyFor: byPhone, code: 'AUTH_OTP_RATE_LIMIT' }),
      (_req, res) => {
        res.json({ ok: true, data: { ttlSeconds: 300 } });
      },
    );
  });

  it('allows requests up to the limit', async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await request(app).post('/otp').send({ phone: '+8801712345678' });
      expect(response.status, `attempt ${String(attempt)}`).toBe(200);
    }
  });

  it('refuses the next one with the OTP-specific code', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(app).post('/otp').send({ phone: '+8801712345678' });
    }

    const response = await request(app).post('/otp').send({ phone: '+8801712345678' });

    expect(response.status).toBe(429);
    // The OTP screen shows a countdown, so it needs its own code
    // (APP_FLOW.md S-A-03).
    expect(response.body.error.code).toBe('AUTH_OTP_RATE_LIMIT');
    expect(response.headers['retry-after']).toBeDefined();
  });

  it('counts each phone number separately', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(app).post('/otp').send({ phone: '+8801712345678' });
    }

    const other = await request(app).post('/otp').send({ phone: '+8801812345678' });
    expect(other.status).toBe(200);
  });

  it('cannot be escaped by omitting the phone number', async () => {
    // Otherwise a malformed request would be an unlimited one.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(app).post('/otp').send({});
    }

    expect((await request(app).post('/otp').send({})).status).toBe(429);
  });

  it('reports the remaining allowance', async () => {
    const response = await request(app).post('/otp').send({ phone: '+8801712345678' });

    expect(response.headers['ratelimit-limit']).toBe('3');
    expect(response.headers['ratelimit-remaining']).toBe('2');
  });

  it('opens a fresh window once the old one has passed', () => {
    const start = 1_000_000;
    expect(counter.hit('k', 1, 60, start).allowed).toBe(true);
    expect(counter.hit('k', 1, 60, start + 1_000).allowed).toBe(false);
    expect(counter.hit('k', 1, 60, start + 61_000).allowed).toBe(true);
  });

  it('falls back to the address when no phone is present', () => {
    const asRequest = (body: unknown): Parameters<typeof byPhone>[0] =>
      ({ body, ip: '203.0.113.9' }) as Parameters<typeof byPhone>[0];

    expect(byPhone(asRequest({ phone: '+8801712345678' }))).toBe('phone:+8801712345678');
    expect(byPhone(asRequest({}))).toBe('ip:203.0.113.9');
    expect(byIp(asRequest({}))).toBe('203.0.113.9');
  });
});

describe('what the logger refuses to record (CLAUDE.md §7)', () => {
  it.each([
    'req.headers.authorization',
    '*.password',
    '*.token',
    '*.otp',
    '*.phone',
    '*.nationalId',
    '*.fullName',
    '*.diagnosis',
    '*.intake',
    '*.providerRef',
    '*.idempotencyKey',
  ])('redacts %s', (path) => {
    // A log line is the easiest place in a healthcare system to leak a
    // person's medical business: shipped to a third party, kept for months,
    // read by people with no clinical relationship to the patient.
    expect(redactedPaths).toContain(path);
  });
});
