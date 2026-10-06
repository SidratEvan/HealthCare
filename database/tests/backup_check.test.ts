/**
 * `deploy/backup.sh check` — the backup container's health check
 * (`docs/PLATFORM_PLAN.md` 1.7, `DEPLOY.md` §S5).
 *
 * A backup nobody looks at fails silently for months and is found out on the
 * day a restore is needed. So every run writes its result down and this check
 * turns it into a container that is `unhealthy` the next morning. These are
 * the cases that decide whether that signal can be trusted: a night that
 * failed, a night that never ran, and a good backup that has since gone stale
 * must all read as failing — and a server started an hour ago must not.
 *
 * The script is run as it is on the server, with `sh`; only the folder and the
 * clock are given to it.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(import.meta.dirname, '../../deploy/backup.sh');

/** 2026-10-03 12:00:00 UTC, in seconds. Any fixed moment would do. */
const NOW = 1_791_028_800;
const HOUR = 3_600;

/**
 * `sh`, wherever it is. On Linux and in CI it is on the path. On Windows it
 * comes with Git, and a shell that is not Git Bash does not have it on the
 * path — so the two places Git installs it are tried as well. Not finding one
 * is an error, never a skipped test.
 */
function findShell(): string {
  if (process.platform !== 'win32') return 'sh';

  const candidates = [
    'C:\\Program Files\\Git\\bin\\sh.exe',
    'C:\\Program Files (x86)\\Git\\bin\\sh.exe',
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found !== undefined) return found;

  const onPath = spawnSync('sh', ['-c', 'exit 0']);
  if (onPath.status === 0) return 'sh';

  throw new Error('No `sh` found. Install Git for Windows, which provides one.');
}

const SHELL = findShell();

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'backup-check-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function check(): { healthy: boolean; says: string } {
  const result = spawnSync(SHELL, [SCRIPT.replaceAll('\\', '/'), 'check'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      BACKUP_DIR: dir.replaceAll('\\', '/'),
      BACKUP_NOW: String(NOW),
    },
  });

  return { healthy: result.status === 0, says: result.stdout.trim() };
}

function status(fields: Record<string, string | number>): void {
  const lines = Object.entries(fields).map(([key, value]) => `${key}=${String(value)}`);
  writeFileSync(join(dir, '.status'), `${lines.join('\n')}\n`);
}

function startedHoursAgo(hours: number): void {
  writeFileSync(join(dir, '.since'), `${String(NOW - hours * HOUR)}\n`);
}

describe('before the first backup', () => {
  it('a server started this morning is not failing: none is due yet', () => {
    startedHoursAgo(3);

    const result = check();
    expect(result.healthy).toBe(true);
    expect(result.says).toContain('none is due yet');
  });

  it('a server that has gone more than a day without one is failing', () => {
    startedHoursAgo(30);

    const result = check();
    expect(result.healthy).toBe(false);
    expect(result.says).toContain('none has completed in 30 hours');
  });

  it('a folder the service has never run in is failing, not silently fine', () => {
    const result = check();
    expect(result.healthy).toBe(false);
    expect(result.says).toContain('never run here');
  });
});

describe('after a run', () => {
  it('last night’s good backup is healthy, and says how it was checked', () => {
    startedHoursAgo(200);
    status({
      result: 'ok',
      reason: '',
      stamp: '20261002-200003',
      verified: 'restore',
      finished: NOW - 16 * HOUR,
    });

    const result = check();
    expect(result.healthy).toBe(true);
    expect(result.says).toBe(
      'backup ok: 20261002-200003, checked by restore, copied to the second location, 16 hours ago',
    );
  });

  it('a run that failed is failing, with its reason', () => {
    startedHoursAgo(200);
    status({
      result: 'failed',
      reason: 'the dump does not restore',
      stamp: '20261002-200003',
      verified: 'list',
      finished: NOW - 16 * HOUR,
    });

    const result = check();
    expect(result.healthy).toBe(false);
    expect(result.says).toBe('backup FAILING: the dump does not restore');
  });

  it('a backup kept on this disk only is failing: that is not a second copy', () => {
    startedHoursAgo(200);
    status({
      result: 'failed',
      reason:
        'written and checked, but only on this disk: no second location is configured (BACKUP_SECOND_DIR)',
      stamp: '20261002-200003',
      verified: 'restore',
      finished: NOW - 16 * HOUR,
    });

    const result = check();
    expect(result.healthy).toBe(false);
    expect(result.says).toContain('only on this disk');
  });

  it('a good backup that has since gone stale is failing: the nights after it did not run', () => {
    startedHoursAgo(200);
    status({
      result: 'ok',
      reason: '',
      stamp: '20260930-200003',
      verified: 'restore',
      finished: NOW - 64 * HOUR,
    });

    const result = check();
    expect(result.healthy).toBe(false);
    expect(result.says).toBe('backup FAILING: the last good one (20260930-200003) is 64 hours old');
  });

  it('just inside a day and two hours is still healthy; just past it is not', () => {
    startedHoursAgo(200);
    const good = {
      result: 'ok',
      reason: '',
      stamp: '20261002-200003',
      verified: 'restore',
    };

    status({ ...good, finished: NOW - 26 * HOUR });
    expect(check().healthy).toBe(true);

    status({ ...good, finished: NOW - 26 * HOUR - 1 });
    expect(check().healthy).toBe(false);
  });
});
