/**
 * A hospital's own server (pilot step 26, `FR-SEC-07`, `FR-LAB-03`):
 * files kept on its disk, no online payment until there is a merchant
 * account, and a public answer to "what does this deployment offer".
 */

import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
      // Under the mock every online method is taken (plan H3).
      paymentMethods: ['bkash', 'nagad', 'card'],
      guestPhoneCheck: false,
      // Asked with no host: the network's address (FR-BRD-07);
      // `portalAddress.routes.test.ts`.
      address: 'network',
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

/**
 * What the self-hosted stack hands the API (`deploy/docker-compose.yml`).
 *
 * The compose file names, one by one, which of `deploy/.env`'s settings
 * reach the API's container; anything it leaves out is silently dropped. The
 * SMS aggregator's address and receipt secret were left out, so following
 * DEPLOY.md §S3 to switch SMS on would have stopped the API from starting
 * (`env.ts` requires both under `SMS_PROVIDER=http`), and bKash and Nagad
 * could never have been configured (pilot-readiness audit, F-05).
 */
describe('the self-hosted stack passes every setting DEPLOY.md asks for', () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const compose = readFileSync(join(root, 'deploy/docker-compose.yml'), 'utf8');
  const apiEnv = compose.slice(compose.indexOf('x-api-env:'), compose.indexOf('\nservices:'));
  const example = readFileSync(join(root, 'deploy/.env.example'), 'utf8');

  const DOCUMENTED = [
    'SMS_PROVIDER',
    'SMS_API_URL',
    'SMS_API_KEY',
    'SMS_SENDER_ID',
    'SMS_DLR_SECRET',
    'SMS_MONTHLY_CAP',
    'PAYMENT_PROVIDER',
    'BKASH_BASE_URL',
    'BKASH_APP_KEY',
    'BKASH_APP_SECRET',
    'BKASH_USERNAME',
    'BKASH_PASSWORD',
    'NAGAD_BASE_URL',
    'NAGAD_MERCHANT_ID',
    'NAGAD_MERCHANT_NUMBER',
    'NAGAD_PUBLIC_KEY',
    'NAGAD_PRIVATE_KEY',
    'TOTP_ENCRYPTION_KEY',
  ];

  it.each(DOCUMENTED)('%s reaches the API and is listed in deploy/.env.example', (key) => {
    expect(apiEnv).toMatch(new RegExp(String.raw`\n\s+${key}: \$\{${key}[:}]`));
    expect(example).toMatch(new RegExp(`^${key}=`, 'm'));
  });
});

/**
 * Where staff may sign in from (`STAFF_NETWORKS`, `DEPLOY.md` S2): the web
 * server's rule, not the API's, so it is checked here as the files state it.
 * Caddy itself was run against this rule on 7 November (allowed and refused
 * addresses, and fourteen disguised paths); this keeps the rule from being
 * edited away unnoticed.
 */
describe('staff sign-in can be held to the hospital’s network (FR-SEC-06, FR-SEC-07)', () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const caddy = readFileSync(join(root, 'deploy/Caddyfile'), 'utf8');
  const compose = readFileSync(join(root, 'deploy/docker-compose.yml'), 'utf8');
  const example = readFileSync(join(root, 'deploy/.env.example'), 'utf8');

  /** One site's block of the Caddyfile, from its address to the next site. */
  function site(origin: string): string {
    const start = caddy.indexOf(`{$${origin}} {`);
    expect(start).toBeGreaterThan(-1);
    return caddy.slice(start, caddy.indexOf('\n}\n', start));
  }

  it('refuses every staff route on the API outside the networks, and nothing else', () => {
    const api = site('API_ORIGIN');
    expect(api).toContain('path /api/v1/staff /api/v1/staff/*');
    expect(api).toContain('not remote_ip {$STAFF_NETWORKS}');
    expect(api).toContain('{"ok":false,"error":{"code":"AUTH_FORBIDDEN_SCOPE"');
    expect(api).toContain('reverse_proxy api:4000');
  });

  it('opens the staff console only inside them', () => {
    const consoleSite = site('CONSOLE_ORIGIN');
    expect(consoleSite).toContain('@outside_staff_networks not remote_ip {$STAFF_NETWORKS}');
    expect(consoleSite).toContain('reverse_proxy console:3100');
  });

  it('leaves the patient app open to everybody', () => {
    expect(site('APP_ORIGIN')).not.toContain('remote_ip');
  });

  it('means everywhere when the hospital has not set it', () => {
    expect(compose).toContain('STAFF_NETWORKS: ${STAFF_NETWORKS:-0.0.0.0/0 ::/0}');
    expect(example).toMatch(/^STAFF_NETWORKS=$/m);
  });
});
