/**
 * The application shell: response envelope, error mapping, probes, and the
 * middleware chain as `app.ts` arranges it.
 *
 * BACKEND.md §7: "All responses: `{ ok: true, data }` or `{ ok: false, error:
 * { code, message, details } }`." A client with one shape to parse is a client
 * that can show a Bangla error for every failure rather than falling back to
 * "something went wrong" whenever the server does something unexpected.
 */

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { ERROR_CODES, NON_FAILURE_CODES, statusFor, type ErrorCode } from '../errors/codes.js';

const app = createApp();

describe('GET /healthz (BACKEND.md §12)', () => {
  it('answers without touching the database', async () => {
    const response = await request(app).get('/healthz');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      data: { status: 'ok', uptimeSeconds: expect.any(Number) },
    });
  });

  it('needs no credential, because a load balancer has none', async () => {
    const response = await request(app).get('/healthz');
    expect(response.status).toBe(200);
  });

  it('is not under the version prefix, so a probe survives a version bump', async () => {
    expect((await request(app).get('/api/v1/healthz')).status).toBe(404);
  });
});

describe('GET /readyz (BACKEND.md §12)', () => {
  it('reports the applied migration version from the database', async () => {
    const response = await request(app).get('/readyz');

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ready');
    expect(response.body.data.checks.database.ok).toBe(true);
    // The schema suite's global setup applied every migration.
    expect(response.body.data.checks.database.schemaVersion).toMatch(/^\d{4}$/);
    expect(response.body.data.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('distinguishes readiness from liveness', async () => {
    // Conflating them turns a brief database blip into a restart loop.
    const live = await request(app).get('/healthz');
    const ready = await request(app).get('/readyz');

    expect(live.body.data).not.toHaveProperty('checks');
    expect(ready.body.data).toHaveProperty('checks');
  });
});

describe('the error envelope', () => {
  it('returns the documented shape for an unmatched path', async () => {
    const response = await request(app).get('/no-such-thing');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: expect.any(String),
        details: { method: 'GET', path: '/no-such-thing' },
      },
    });
  });

  it('returns the shape for an unmatched path under the version prefix too', async () => {
    const response = await request(app).post('/api/v1/bookings');

    expect(response.status).toBe(404);
    expect(response.body.ok).toBe(false);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('never returns HTML, which a Bangla client cannot render into a message', async () => {
    const response = await request(app).get('/no-such-thing');

    expect(response.headers['content-type']).toMatch(/application\/json/);
  });

  it('rejects a body that is not valid JSON with the envelope, not a stack trace', async () => {
    const response = await request(app)
      .post('/api/v1/anything')
      .set('content-type', 'application/json')
      .send('{"broken":');

    expect(response.body.ok).toBe(false);
    expect(response.body.error.code).toBe('INTERNAL');
    // The parse error's message would name the offending byte offset of a
    // request body; nothing about it reaches the client (BACKEND.md §9).
    expect(JSON.stringify(response.body)).not.toContain('JSON');
  });
});

describe('request correlation', () => {
  it('assigns a request id and returns it', async () => {
    const response = await request(app).get('/healthz');

    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('honours an inbound id, so a trace crosses from the console to the API', async () => {
    const response = await request(app).get('/healthz').set('x-request-id', 'console-abc-123');

    expect(response.headers['x-request-id']).toBe('console-abc-123');
  });

  it('ignores an absurdly long inbound id, which would sit in every log line', async () => {
    const response = await request(app).get('/healthz').set('x-request-id', 'x'.repeat(200));

    expect(response.headers['x-request-id']).not.toBe('x'.repeat(200));
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('hardening', () => {
  it('does not advertise the framework', async () => {
    const response = await request(app).get('/healthz');
    expect(response.headers).not.toHaveProperty('x-powered-by');
  });

  it('refuses a body larger than the limit', async () => {
    // File uploads go to Supabase Storage through a signed URL, so nothing
    // legitimate arrives here at this size (BACKEND.md §0).
    const response = await request(app)
      .post('/api/v1/anything')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ padding: 'x'.repeat(400_000) }));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.body.ok).toBe(false);
  });
});

describe('error codes (BACKEND.md §9)', () => {
  it('maps every code to exactly one status', () => {
    for (const [code, definition] of Object.entries(ERROR_CODES)) {
      expect(statusFor(code as ErrorCode), code).toBe(definition.status);
    }
  });

  it('covers every code the document lists', () => {
    for (const documented of [
      'AUTH_OTP_RATE_LIMIT',
      'AUTH_OTP_INVALID',
      'AUTH_FORBIDDEN_SCOPE',
      'GUEST_LINK_EXPIRED',
      'BOOKING_SLOT_TAKEN',
      'BOOKING_DUPLICATE',
      'QUEUE_CONFLICT',
      'QUEUE_GUARD_FAILED',
      'QUEUE_EVENT_DUPLICATE',
      'PAYMENT_FAILED',
      'CONSENT_REQUIRED',
      'CAPACITY_STALE',
      'VALIDATION_FAILED',
    ]) {
      expect(ERROR_CODES, documented).toHaveProperty(documented);
    }
  });

  it('agrees with the document on each status', () => {
    expect(statusFor('AUTH_OTP_RATE_LIMIT')).toBe(429);
    expect(statusFor('AUTH_OTP_INVALID')).toBe(401);
    expect(statusFor('AUTH_FORBIDDEN_SCOPE')).toBe(403);
    expect(statusFor('GUEST_LINK_EXPIRED')).toBe(410);
    expect(statusFor('BOOKING_SLOT_TAKEN')).toBe(409);
    expect(statusFor('BOOKING_DUPLICATE')).toBe(409);
    expect(statusFor('QUEUE_CONFLICT')).toBe(409);
    expect(statusFor('QUEUE_GUARD_FAILED')).toBe(422);
    expect(statusFor('PAYMENT_FAILED')).toBe(402);
    expect(statusFor('CONSENT_REQUIRED')).toBe(403);
    expect(statusFor('VALIDATION_FAILED')).toBe(400);
  });

  it('gives the two non-failures a success status', () => {
    // A replayed offline batch and a stale capacity figure are outcomes, not
    // errors: the data is returned and labelled.
    for (const code of NON_FAILURE_CODES) {
      expect(statusFor(code), code).toBeLessThan(300);
    }
  });
});
