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
import {
  ANONYMOUS_PER_MINUTE,
  anonymousCeiling,
  byIp,
  byPhone,
  counter,
  rateLimit,
} from '../middleware/rateLimit.js';
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

describe('a limit on an address, where many people share one (ADDRESS_RATE_LIMIT_FACTOR)', () => {
  beforeEach(() => {
    counter.reset();
  });

  /** One route limited to two per address, for an address shared `factor` times over. */
  function sharedBy(factor?: number): Express {
    return harness((a) => {
      const options = { limit: 2, windowSeconds: 600, keyFor: byIp };
      a.post(
        '/start',
        factor === undefined ? rateLimit(options) : rateLimit(options, factor),
        (_req, res) => {
          res.json({ ok: true });
        },
      );
    });
  }

  it('holds an address to the limit as written, unless a deployment says it is shared', async () => {
    // Nothing sets the factor under test, so this is the default: one.
    const app = sharedBy();

    expect((await request(app).post('/start')).status).toBe(200);
    expect((await request(app).post('/start')).status).toBe(200);
    expect((await request(app).post('/start')).status).toBe(429);
  });

  it('lets an address that stands for several people through that many times over', async () => {
    const app = sharedBy(3);

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const response = await request(app).post('/start');
      expect(response.status, `attempt ${String(attempt)}`).toBe(200);
      // The allowance it reports is the one it enforces.
      expect(response.headers['ratelimit-limit']).toBe('6');
    }

    expect((await request(app).post('/start')).status).toBe(429);
  });

  it('never stretches a limit on a phone number: that one is a person, not an address', async () => {
    const app = harness((a) => {
      a.post(
        '/otp',
        rateLimit({ limit: 2, windowSeconds: 600, keyFor: byPhone }, 50),
        (_req, res) => {
          res.json({ ok: true });
        },
      );
    });
    const phone = { phone: '+8801712345678' };

    expect((await request(app).post('/otp').send(phone)).status).toBe(200);
    expect((await request(app).post('/otp').send(phone)).status).toBe(200);
    expect((await request(app).post('/otp').send(phone)).status).toBe(429);
  });
});

describe('the ceiling on what is asked without an account (plan I2b)', () => {
  beforeEach(() => {
    counter.reset();
  });

  it('a named bucket counts one caller across every route it is on', async () => {
    const shared = rateLimit({ limit: 2, windowSeconds: 60, keyFor: byIp, bucket: 'probe' });
    const app = harness((a) => {
      for (const path of ['/one', '/two', '/three']) {
        a.get(path, shared, (_req, res) => {
          res.json({ ok: true });
        });
      }
    });

    expect((await request(app).get('/one')).status).toBe(200);
    expect((await request(app).get('/two')).status).toBe(200);
    expect((await request(app).get('/three')).status).toBe(429);
  });

  /** The ceiling, with a header standing in for a token so a test can be somebody. */
  const app = harness((a) => {
    a.use((req, _res, next) => {
      if (req.get('x-probe-signed-in') !== undefined) {
        Object.assign(req, { principal: { kind: 'patient', id: 'probe', roles: [] } });
      }
      next();
    });
    a.use(anonymousCeiling);
    a.get('/search', (_req, res) => {
      res.json({ ok: true });
    });
    a.post('/webhooks/sms-dlr', (_req, res) => {
      res.json({ ok: true });
    });
  });

  /** Spends this address's whole minute, as a script in a loop would. */
  function spendTheMinute(): void {
    const now = Date.now();
    for (const address of ['::ffff:127.0.0.1', '127.0.0.1', '::1']) {
      for (let hit = 0; hit < ANONYMOUS_PER_MINUTE; hit += 1) {
        counter.hit(`anonymous:${address}`, ANONYMOUS_PER_MINUTE, 60, now);
      }
    }
  }

  it('lets a waiting room’s worth of phones through, and refuses past it', async () => {
    expect((await request(app).get('/search')).status).toBe(200);
    expect(ANONYMOUS_PER_MINUTE).toBeGreaterThanOrEqual(100 * 12);
    spendTheMinute();
    const refused = await request(app).get('/search');
    expect(refused.status).toBe(429);
    expect(refused.body.error.code).toBe('RATE_LIMITED');
  });

  it('does not count a caller with an account, who is limited by what they do', async () => {
    spendTheMinute();
    expect((await request(app).get('/search').set('x-probe-signed-in', '1')).status).toBe(200);
  });

  it('does not count an aggregator’s delivery reports, which are each signed', async () => {
    spendTheMinute();
    expect((await request(app).post('/webhooks/sms-dlr').send({})).status).toBe(200);
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
