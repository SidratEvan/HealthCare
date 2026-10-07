/**
 * What `/readyz` says about the deployment besides its database (plan I2;
 * `PRD.md` `FR-SUP-06`, its last sentence; migration 0055; `shared/domain`
 * `org/deployment`, whose rule has its own tests).
 *
 * What must hold here, where the rule meets the server: the backup the owner
 * recorded is the one reported; a worker that has stopped going through is
 * said; none of it takes the server out of rotation; and nothing in the
 * answer is about a hospital or a person, since anybody may ask.
 */

import { sql } from 'kysely';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import * as heartbeat from '../services/heartbeat.service.js';

import { asOwner } from './support/ownerDb.js';

import type { Express } from 'express';

let app: Express;

beforeAll(() => {
  app = createApp();
});

afterEach(async () => {
  vi.restoreAllMocks();
  heartbeat.reset();
  await asOwner(async (owner) => {
    await sql`DELETE FROM backup_runs WHERE stamp LIKE 'test-%'`.execute(owner);
  });
});

async function watchBackups(hours: number): Promise<void> {
  const env = await import('../env.js');
  vi.spyOn(env, 'env', 'get').mockReturnValue({ ...env.env, BACKUP_MAX_AGE_HOURS: hours });
}

async function recordBackup(result: 'ok' | 'failed', hoursAgo: number): Promise<void> {
  await asOwner(async (owner) => {
    await sql`
      INSERT INTO backup_runs (finished_at, result, verified, stamp, reason)
      VALUES (now() - make_interval(hours => ${hoursAgo}), ${result},
              ${result === 'ok' ? 'restore' : null}, ${`test-${String(hoursAgo)}`},
              ${result === 'ok' ? null : 'the dump does not restore'})
    `.execute(owner);
  });
}

async function readiness(): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await request(app).get('/readyz');
  return { status: response.status, body: response.body.data as Record<string, unknown> };
}

interface Signals {
  backup: Record<string, unknown>;
  messages: { due: number; oldestDueMinutes: number | null };
  workers: { worker: string; late: boolean; lastOkSecondsAgo: number | null }[];
  attention: string[];
}

const signalsOf = (body: Record<string, unknown>): Signals => body['signals'] as Signals;

describe('the deployment, besides its database (plan I2)', () => {
  it('is said beside the database, in counts and ages and nothing else', async () => {
    const { status, body } = await readiness();
    expect(status).toBe(200);
    const signals = signalsOf(body);
    expect(Object.keys(signals).sort()).toEqual(['attention', 'backup', 'messages', 'workers']);
    expect(Object.keys(signals.messages).sort()).toEqual(['due', 'oldestDueMinutes']);
    expect(typeof signals.messages.due).toBe('number');
    // Anybody may ask: no hospital, no person, no message is in it.
    expect(JSON.stringify(signals)).not.toMatch(/hospital|phone|patient|\+880/i);
  });

  it('reports backups as not watched where nobody said how old one may be', async () => {
    await recordBackup('failed', 1);
    const signals = signalsOf((await readiness()).body);
    expect(signals.backup['watched']).toBe(false);
    expect(signals.attention).not.toContain('backup_failed');
  });
});

describe('the nightly backup (FR-SUP-06)', () => {
  it('reports the run the backup recorded, and the last good one', async () => {
    await watchBackups(26);
    await recordBackup('ok', 30);
    await recordBackup('failed', 2);

    const { status, body } = await readiness();
    const signals = signalsOf(body);
    expect(signals.backup).toMatchObject({
      watched: true,
      lastResult: 'failed',
      lastOkVerified: 'restore',
      lastOkHoursAgo: 30,
    });
    expect(signals.attention).toEqual(expect.arrayContaining(['backup_failed', 'backup_stale']));
    // A failed backup is no reason to stop serving a reception desk.
    expect(status).toBe(200);
    expect(body['status']).toBe('ready');
  });

  it('a good one inside the allowance asks for nothing', async () => {
    await watchBackups(26);
    await recordBackup('ok', 3);
    const signals = signalsOf((await readiness()).body);
    expect(signals.backup).toMatchObject({ lastResult: 'ok', lastOkHoursAgo: 3 });
    expect(signals.attention).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^backup_/)]),
    );
  });
});

describe('the work on a clock', () => {
  it('names a worker that has stopped going through, and stays ready', async () => {
    heartbeat.register('sender', 5_000);
    heartbeat.beat('sender', true, new Date(Date.now() - 60_000));
    heartbeat.beat('sender', false);

    const { status, body } = await readiness();
    const signals = signalsOf(body);
    expect(signals.workers).toEqual([
      expect.objectContaining({ worker: 'sender', late: true, lastOkSecondsAgo: 60 }),
    ]);
    expect(signals.attention).toContain('worker_late');
    expect(status).toBe(200);
  });

  it('one that is going through is not late', async () => {
    heartbeat.register('offers', 30_000);
    heartbeat.beat('offers', true);
    const signals = signalsOf((await readiness()).body);
    expect(signals.workers).toEqual([expect.objectContaining({ worker: 'offers', late: false })]);
    expect(signals.attention).not.toContain('worker_late');
  });
});
