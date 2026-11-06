/**
 * `deploy/watchdog.mjs` — somebody is told (`DEPLOY.md` §S5a, `FR-SUP-06`;
 * MARKS readiness F-07).
 *
 * An alert that cries wolf is muted within a week, and one that stays quiet
 * when a backup failed is worse than none, because people stop looking. These
 * are the cases that decide whether it can be trusted: told once when
 * something goes wrong, not every minute; told again while it lasts; told when
 * it is right; a restart is not an alarm; a message that could not be posted
 * is not forgotten; the daily all-well comes once.
 *
 * The script is run as it is on the server, with `node`, against a stand-in
 * API and a stand-in webhook; only the clock and the state file are given.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(import.meta.dirname, '../../deploy/watchdog.mjs');

/** 2026-10-03 12:00:00 UTC, in seconds. */
const NOW = 1_791_028_800;
const HOUR = 3_600;

interface Stand {
  /** What `/readyz` answers; `null` drops the connection. */
  readyz: { status: number; body: unknown } | null;
  /** What the webhook answers. */
  webhookStatus: number;
  posts: { contentType: string; body: string }[];
}

let dir: string;
let server: Server;
let base: string;
let stand: Stand;

function ready(attention: string[] = []): Stand['readyz'] {
  return {
    status: 200,
    body: {
      ok: true,
      data: {
        status: 'ready',
        checks: { database: { ok: true, latencyMs: 2, schemaVersion: '0063' } },
        signals: { attention },
      },
    },
  };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'watchdog-'));
  stand = { readyz: ready(), webhookStatus: 200, posts: [] };
  server = createServer((req, res) => {
    if (req.url === '/readyz') {
      if (stand.readyz === null) {
        req.socket.destroy();
        return;
      }
      res.writeHead(stand.readyz.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(stand.readyz.body));
      return;
    }
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    req.on('end', () => {
      stand.posts.push({ contentType: req.headers['content-type'] ?? '', body });
      res.writeHead(stand.webhookStatus);
      res.end();
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  rmSync(dir, { recursive: true, force: true });
});

/** One check at `at` seconds, as the server runs it. */
function check(at: number, extra: Record<string, string> = {}): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [SCRIPT, 'once'], {
      env: {
        PATH: process.env.PATH ?? '',
        WATCHDOG_READYZ_URL: `${base}/readyz`,
        WATCHDOG_STATE_FILE: join(dir, 'state.json'),
        WATCHDOG_NOW: String(at),
        ALERT_WEBHOOK_URL: `${base}/hook`,
        ALERT_SERVER_NAME: 'Test server',
        ALERT_DAILY_UTC_HOUR: '',
        ...extra,
      },
      stdio: 'ignore',
    });
    child.on('error', fail);
    child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`exit ${String(code)}`))));
  });
}

function texts(): string[] {
  return stand.posts.map((post) => (JSON.parse(post.body) as { text: string }).text);
}

describe('deploy/watchdog.mjs', () => {
  it('says nothing while all is well', async () => {
    await check(NOW);
    await check(NOW + 60);
    expect(stand.posts).toEqual([]);
  });

  it('is told once when a backup fails, again while it lasts, and when it is right', async () => {
    stand.readyz = ready(['backup_failed']);
    await check(NOW);
    await check(NOW + 60);
    await check(NOW + 5 * HOUR);
    expect(texts()).toHaveLength(1);
    expect(texts()[0]).toContain('Test server: needs attention');
    expect(texts()[0]).toContain("Last night's backup failed.");

    await check(NOW + 6 * HOUR);
    expect(texts()).toHaveLength(2);
    expect(texts()[1]).toContain('still needs attention, since 2026-10-03 12:00 UTC');

    stand.readyz = ready();
    await check(NOW + 6 * HOUR + 60);
    expect(texts()).toHaveLength(3);
    expect(texts()[2]).toContain('all well again');
  });

  it('is told when what is wrong changes', async () => {
    stand.readyz = ready(['backup_failed']);
    await check(NOW);
    stand.readyz = ready(['backup_failed', 'messages_overdue']);
    await check(NOW + 60);
    expect(texts()).toHaveLength(2);
    expect(texts()[1]).toContain('has changed');
    expect(texts()[1]).toContain('Messages to patients are due');
  });

  it('does not call a restart an outage: three misses in a row are', async () => {
    stand.readyz = null;
    await check(NOW);
    await check(NOW + 60);
    expect(stand.posts).toEqual([]);
    await check(NOW + 120);
    expect(texts()).toHaveLength(1);
    expect(texts()[0]).toContain('The API is not answering.');
  });

  it('a miss that recovers before the third leaves no alarm', async () => {
    stand.readyz = null;
    await check(NOW);
    await check(NOW + 60);
    stand.readyz = ready();
    await check(NOW + 120);
    stand.readyz = null;
    await check(NOW + 180);
    await check(NOW + 240);
    expect(stand.posts).toEqual([]);
  });

  it('reports an API that answers but cannot reach its database', async () => {
    stand.readyz = {
      status: 503,
      body: {
        ok: true,
        data: { status: 'degraded', checks: { database: { ok: false } }, signals: null },
      },
    };
    await check(NOW);
    expect(texts()[0]).toContain('cannot reach the database');
  });

  it('tries a message again when the webhook did not take it', async () => {
    stand.readyz = ready(['worker_late']);
    stand.webhookStatus = 500;
    await check(NOW);
    expect(stand.posts).toHaveLength(1);
    stand.webhookStatus = 200;
    await check(NOW + 60);
    expect(stand.posts).toHaveLength(2);
    expect(texts()[1]).toContain('needs attention');
    await check(NOW + 120);
    expect(stand.posts).toHaveLength(2);
  });

  it('sends the daily all-well once a day, from its hour', async () => {
    // NOW is 12:00 UTC.
    await check(NOW, { ALERT_DAILY_UTC_HOUR: '13' });
    expect(stand.posts).toEqual([]);
    await check(NOW + HOUR, { ALERT_DAILY_UTC_HOUR: '13' });
    await check(NOW + 2 * HOUR, { ALERT_DAILY_UTC_HOUR: '13' });
    expect(texts()).toHaveLength(1);
    expect(texts()[0]).toContain('all well');
    expect(texts()[0]).toContain('the watchdog has stopped');
    await check(NOW + 25 * HOUR, { ALERT_DAILY_UTC_HOUR: '13' });
    expect(texts()).toHaveLength(2);
  });

  it('posts the message itself as text for ntfy', async () => {
    stand.readyz = ready(['backup_none']);
    await check(NOW, { ALERT_WEBHOOK_FORMAT: 'text' });
    expect(stand.posts[0]?.contentType).toContain('text/plain');
    expect(stand.posts[0]?.body).toContain('No backup has ever completed');
  });

  it('with no webhook, writes to its log and never fails', async () => {
    stand.readyz = ready(['backup_failed']);
    await check(NOW, { ALERT_WEBHOOK_URL: '' });
    expect(stand.posts).toEqual([]);
  });
});
