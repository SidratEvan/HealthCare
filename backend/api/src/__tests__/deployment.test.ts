/**
 * A hospital's own server (pilot step 26, `FR-SEC-07`, `FR-LAB-03`):
 * files kept on its disk, no online payment until there is a merchant
 * account, and a public answer to "what does this deployment offer".
 */

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LocalStorageAdapter } from '../adapters/storage.js';
import { createApp } from '../app.js';
import { env } from '../env.js';

import type { Express } from 'express';

const BASE = '/api/v1';
let app: Express;
let dir: string;

beforeAll(async () => {
  app = createApp();
  dir = await mkdtemp(join(tmpdir(), 'hwbd-files-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('STORAGE_PROVIDER=local', () => {
  it('keeps a report on disk, with its type, and gives it back after a restart', async () => {
    const bytes = Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1');
    const first = new LocalStorageAdapter(dir);
    const stored = await first.put({
      key: 'reports/abc.pdf',
      contentType: 'application/pdf',
      bytes,
    });
    expect(stored.url).toMatch(/^\/files\/reports%2Fabc\.pdf\?expires=\d+&sig=/);

    // A new adapter is a restarted process: nothing held in memory.
    const again = await new LocalStorageAdapter(dir).get('reports/abc.pdf');
    expect(again).toEqual({ contentType: 'application/pdf', bytes });
    expect(await readdir(join(dir, 'reports'))).toContain('abc.pdf');
  });

  it('refuses a key that would leave its directory', async () => {
    const adapter = new LocalStorageAdapter(dir);
    await expect(
      adapter.put({
        key: '../escape.pdf',
        contentType: 'application/pdf',
        bytes: Buffer.from('x'),
      }),
    ).rejects.toThrow('storage_key_outside_directory');
    expect(await adapter.get('../../etc/passwd')).toBeNull();
  });
});

describe('PAYMENT_PROVIDER=off, and GET /config', () => {
  const mutable = env as { PAYMENT_PROVIDER: string };
  const before = env.PAYMENT_PROVIDER;

  afterAll(() => {
    mutable.PAYMENT_PROVIDER = before;
  });

  it('says what this deployment offers', async () => {
    const response = await request(app).get(`${BASE}/config`);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      demo: true,
      onlinePayments: true,
      guestPhoneCheck: false,
      // The network's own app is nobody's (FR-BRD-02); `scope.routes.test.ts`.
      scope: null,
    });
  });

  it('offers only paying at the hospital, and refuses an online method before writing anything', async () => {
    mutable.PAYMENT_PROVIDER = 'off';
    expect((await request(app).get(`${BASE}/config`)).body.data.onlinePayments).toBe(false);
    const response = await request(app)
      .post(`${BASE}/bookings`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({
        sessionId: crypto.randomUUID(),
        method: 'bkash',
        guest: { phone: '+8801712345678', name: 'কেউ (ডেমো)', ageYears: 30, sex: 'female' },
      });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('PAYMENT_UNAVAILABLE');
  });
});
