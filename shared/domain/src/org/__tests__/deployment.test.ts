import { describe, expect, it } from 'vitest';

import {
  deploymentSignals,
  type BackupRun,
  type DeploymentInput,
  type WorkerBeat,
} from '../deployment.js';

import type { Timestamp } from '../../types/ids.js';

const NOW = '2026-10-07T12:00:00.000Z' as Timestamp;
const minutesAgo = (minutes: number): Timestamp =>
  new Date(Date.parse(NOW) - minutes * 60_000).toISOString() as Timestamp;
const hoursAgo = (hours: number): Timestamp => minutesAgo(hours * 60);

const SENDER_MS = 5_000;
const OFFERS_MS = 30_000;
const HOURLY_MS = 3_600_000;

function beats(
  overrides: Partial<Record<WorkerBeat['worker'], Partial<WorkerBeat>>> = {},
): WorkerBeat[] {
  const base: WorkerBeat[] = [
    { worker: 'sender', everyMs: SENDER_MS, lastOkAt: minutesAgo(0), lastFailedAt: null },
    { worker: 'offers', everyMs: OFFERS_MS, lastOkAt: minutesAgo(0), lastFailedAt: null },
    { worker: 'hourly', everyMs: HOURLY_MS, lastOkAt: minutesAgo(20), lastFailedAt: null },
  ];
  return base.map((beat) => ({ ...beat, ...overrides[beat.worker] }));
}

const run = (result: BackupRun['result'], at: Timestamp): BackupRun => ({
  result,
  finishedAt: at,
  verified: result === 'ok' ? 'restore' : null,
});

function input(overrides: Partial<DeploymentInput> = {}): DeploymentInput {
  const lastNight = run('ok', hoursAgo(10));
  return {
    now: NOW,
    startedAt: hoursAgo(48),
    backup: { maxAgeHours: 26, last: lastNight, lastOk: lastNight },
    messages: { due: 0, oldestDueAt: null },
    workers: beats(),
    ...overrides,
  };
}

describe('a deployment that is well (plan I2)', () => {
  it('asks for nothing, and says how old each thing is', () => {
    const signals = deploymentSignals(input());
    expect(signals.attention).toEqual([]);
    expect(signals.backup).toEqual({
      watched: true,
      lastResult: 'ok',
      lastAt: hoursAgo(10),
      lastOkAt: hoursAgo(10),
      lastOkVerified: 'restore',
      lastOkHoursAgo: 10,
    });
    expect(signals.workers.map((one) => [one.worker, one.everySeconds, one.late])).toEqual([
      ['sender', 5, false],
      ['offers', 30, false],
      ['hourly', 3600, false],
    ]);
  });
});

describe('the backup (FR-SUP-06)', () => {
  it('a night that failed asks for attention, even with a good one the night before', () => {
    const signals = deploymentSignals(
      input({
        backup: {
          maxAgeHours: 26,
          last: run('failed', hoursAgo(10)),
          lastOk: run('ok', hoursAgo(34)),
        },
      }),
    );
    expect(signals.attention).toContain('backup_failed');
    expect(signals.attention).toContain('backup_stale');
    expect(signals.backup.lastOkHoursAgo).toBe(34);
  });

  it('a good one older than the allowance is stale, at the same figure `backup.sh check` uses', () => {
    const old = run('ok', hoursAgo(27));
    expect(
      deploymentSignals(input({ backup: { maxAgeHours: 26, last: old, lastOk: old } })).attention,
    ).toEqual(['backup_stale']);
    const recent = run('ok', hoursAgo(25));
    expect(
      deploymentSignals(input({ backup: { maxAgeHours: 26, last: recent, lastOk: recent } }))
        .attention,
    ).toEqual([]);
  });

  it('none recorded is a failure only after a full allowance of the server running', () => {
    const none = { maxAgeHours: 26, last: null, lastOk: null };
    expect(deploymentSignals(input({ backup: none, startedAt: hoursAgo(2) })).attention).toEqual(
      [],
    );
    expect(deploymentSignals(input({ backup: none, startedAt: hoursAgo(30) })).attention).toEqual([
      'backup_none',
    ]);
  });

  it('a deployment that does not watch its backups is told so, and never flagged for them', () => {
    const signals = deploymentSignals(
      input({ backup: { maxAgeHours: null, last: null, lastOk: null }, startedAt: hoursAgo(500) }),
    );
    expect(signals.backup.watched).toBe(false);
    expect(signals.attention).toEqual([]);
  });
});

describe('messages due and not sent', () => {
  it('a message past due by more than five minutes is a sender not running', () => {
    expect(
      deploymentSignals(input({ messages: { due: 3, oldestDueAt: minutesAgo(6) } })).attention,
    ).toEqual(['messages_overdue']);
  });

  it('one that has just come due is the sender about to take it', () => {
    const signals = deploymentSignals(input({ messages: { due: 3, oldestDueAt: minutesAgo(1) } }));
    expect(signals.attention).toEqual([]);
    expect(signals.messages).toEqual({ due: 3, oldestDueMinutes: 1 });
  });
});

describe('the work on a clock', () => {
  it('a worker that has not gone through for three of its intervals is late', () => {
    const signals = deploymentSignals(
      input({
        workers: beats({ offers: { lastOkAt: minutesAgo(2), lastFailedAt: minutesAgo(0) } }),
      }),
    );
    expect(signals.attention).toEqual(['worker_late']);
    expect(signals.workers.find((one) => one.worker === 'offers')).toMatchObject({
      late: true,
      lastOkSecondsAgo: 120,
    });
  });

  it('one not yet heard from is given three intervals from the start', () => {
    const fresh = beats({ sender: { lastOkAt: null } });
    expect(
      deploymentSignals(input({ workers: fresh, startedAt: minutesAgo(0) })).attention,
    ).toEqual([]);
    expect(deploymentSignals(input({ workers: fresh })).attention).toEqual(['worker_late']);
  });

  it('says every worry at once, in a fixed order', () => {
    const signals = deploymentSignals(
      input({
        backup: { maxAgeHours: 26, last: run('failed', hoursAgo(1)), lastOk: null },
        messages: { due: 1, oldestDueAt: minutesAgo(30) },
        workers: beats({ hourly: { lastOkAt: hoursAgo(4) } }),
      }),
    );
    expect(signals.attention).toEqual(['backup_failed', 'messages_overdue', 'worker_late']);
  });
});
