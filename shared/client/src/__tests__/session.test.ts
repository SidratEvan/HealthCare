/**
 * Staleness, and the API client's one important distinction.
 *
 * Both are small functions carrying a lot of the product's honesty rules
 * (`PRD.md` §3.2, `FR-OFF-03`, `FR-OFF-05`), which is exactly the kind of code
 * that gets quietly "simplified" later.
 */

import { describe, expect, it, vi } from 'vitest';

import { ApiClient, ApiError, NetworkError } from '../api/client.js';
import { DEFAULT_STALE_AFTER_MS, isStale } from '../realtime/session.js';

describe('isStale (FR-OFF-03, FR-OFF-04)', () => {
  const now = new Date('2026-09-18T12:00:00Z');

  it('is fresh inside the threshold', () => {
    const recent = new Date(now.getTime() - 60_000).toISOString();
    expect(isStale(recent, now, DEFAULT_STALE_AFTER_MS)).toBe(false);
  });

  it('is stale past it', () => {
    const old = new Date(now.getTime() - 11 * 60_000).toISOString();
    expect(isStale(old, now, DEFAULT_STALE_AFTER_MS)).toBe(true);
  });

  it('is stale exactly at the threshold', () => {
    // Erring short is deliberate: claiming fresh data is stale costs a glance,
    // the reverse costs trust.
    const exactly = new Date(now.getTime() - DEFAULT_STALE_AFTER_MS).toISOString();
    expect(isStale(exactly, now, DEFAULT_STALE_AFTER_MS)).toBe(true);
  });

  it('treats never having heard from the server as stale', () => {
    // The honest answer. A number on screen is a guess until something
    // confirms it, and this is what stops a console showing yesterday's queue
    // as though it were live (FR-OFF-05).
    expect(isStale(null, now, DEFAULT_STALE_AFTER_MS)).toBe(true);
  });

  it('honours the threshold a hospital set for itself', () => {
    // hospital_settings.stale_threshold_minutes (FR-OFF-04) is the hospital's
    // setting; the constant is only the fallback.
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60_000).toISOString();
    expect(isStale(twoMinutesAgo, now, 60_000)).toBe(true);
    expect(isStale(twoMinutesAgo, now, 5 * 60_000)).toBe(false);
  });
});

describe('ApiClient', () => {
  const ok = (data: unknown): Response =>
    new Response(JSON.stringify({ ok: true, data }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  function client(fetchImpl: typeof fetch, token: string | null = 'tok'): ApiClient {
    return new ApiClient({ baseUrl: 'https://api.test', getToken: () => token, fetchImpl });
  }

  /**
   * A fetch double that keeps fetch's own signature.
   *
   * Declaring the parameters rather than casting is what lets the assertions
   * below read `calls[0][1]` as a `RequestInit` — an argument-less `vi.fn()`
   * infers a zero-length tuple and every inspection becomes a cast.
   */
  function fetchDouble(response: () => Promise<Response>) {
    return vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => response());
  }

  /** The `RequestInit` a double was called with. */
  function initOf(mock: ReturnType<typeof fetchDouble>): RequestInit {
    return mock.mock.calls[0]?.[1] ?? {};
  }

  function headersOf(mock: ReturnType<typeof fetchDouble>): Record<string, string> {
    return (initOf(mock).headers ?? {}) as Record<string, string>;
  }

  it('unwraps the success envelope', async () => {
    const fetchImpl = fetchDouble(() => Promise.resolve(ok({ seq: 7 })));
    const result = await client(fetchImpl).get<{ seq: number }>('/x');
    expect(result).toEqual({ seq: 7 });
  });

  it('sends the bearer token when there is one, and omits it when there is not', async () => {
    const fetchImpl = fetchDouble(() => Promise.resolve(ok({})));
    await client(fetchImpl).get('/x');
    expect(headersOf(fetchImpl)['authorization']).toBe('Bearer tok');

    const anon = fetchDouble(() => Promise.resolve(ok({})));
    await client(anon, null).get('/x');
    expect(headersOf(anon)['authorization']).toBeUndefined();
  });

  it('sends no body on a GET', async () => {
    // `exactOptionalPropertyTypes` aside, a GET with an explicit undefined body
    // is not the same as one without, and some runtimes care.
    const fetchImpl = fetchDouble(() => Promise.resolve(ok({})));
    await client(fetchImpl).get('/x');
    expect(initOf(fetchImpl).body).toBeUndefined();
  });

  it('carries an idempotency key when given one', async () => {
    const fetchImpl = fetchDouble(() => Promise.resolve(ok({})));
    await client(fetchImpl).post('/x', { a: 1 }, 'key-1');
    expect(headersOf(fetchImpl)['idempotency-key']).toBe('key-1');
  });

  it('throws ApiError with the stable code the UI maps to Bangla copy', async () => {
    const fetchImpl = fetchDouble(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            ok: false,
            error: { code: 'QUEUE_GUARD_FAILED', message: 'Not allowed yet.' },
          }),
          { status: 422, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    await expect(client(fetchImpl).get('/x')).rejects.toThrow(ApiError);
    await expect(client(fetchImpl).get('/x')).rejects.toMatchObject({
      code: 'QUEUE_GUARD_FAILED',
      status: 422,
    });
  });

  it('throws NetworkError when the request never reached the server', async () => {
    // The distinction the whole offline design turns on: "the server said no"
    // rolls a row back, "there was no server" leaves it applied and queued.
    const fetchImpl = fetchDouble(() => Promise.reject(new Error('Failed to fetch')));
    await expect(client(fetchImpl).get('/x')).rejects.toThrow(NetworkError);
  });
});
