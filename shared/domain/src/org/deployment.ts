/**
 * How the deployment itself is doing, for `/readyz` (`PRD.md` `FR-SUP-06`:
 * "the age of the last backup is the deployment's and not one hospital's; it
 * belongs to the health endpoints"; `BACKEND.md` §3 health; plan I2).
 *
 * Three things a server can be quietly failing at while every request it is
 * sent still answers:
 *
 * - **the nightly backup**, which runs in another container and used to tell
 *   only that container's health check;
 * - **the messages that are due and not sent**, which is the sender not
 *   running, or a gateway refusing everything;
 * - **the work the server does on a clock**: the sender's look for what is
 *   due, the timer that lapses an offered chair, the hourly jobs.
 *
 * None of these takes the server out of rotation. Readiness is the database
 * and nothing else: a backup that failed last night is no reason to stop
 * serving a reception desk this morning, and a load balancer that took the
 * API away for it would turn one problem into two. What is wrong is said in
 * `attention`, in words a monitor can match.
 *
 * ## Backups a deployment does not watch
 *
 * The demonstration's database is Supabase's, backed up by Supabase, with no
 * backup container and no row here. A server says its backups are watched by
 * setting how old the last good one may be (`BACKUP_MAX_AGE_HOURS`, the same
 * figure `deploy/backup.sh check` uses); without it, backups are reported as
 * not watched, never as missing.
 *
 * A watched deployment with no record yet is given the same grace the backup
 * container gives itself: one allowance from when the server started.
 *
 * Pure: the counting is the database's and the clock is passed in.
 */

import { MESSAGE_WAITING_MINUTES } from './health.js';

import type { Timestamp } from '../types/ids.js';

/** The work the API does on a clock, in its own process. */
export const DEPLOYMENT_WORKERS = ['sender', 'offers', 'hourly', 'payments'] as const;
export type DeploymentWorker = (typeof DEPLOYMENT_WORKERS)[number];

/** A worker is late when nothing has gone right for this many of its intervals. */
export const WORKER_LATE_INTERVALS = 3;

/** What asks for attention. Order is the order they are said in. */
export const DEPLOYMENT_ATTENTIONS = [
  'backup_failed',
  'backup_stale',
  'backup_none',
  'messages_overdue',
  'worker_late',
] as const;
export type DeploymentAttention = (typeof DEPLOYMENT_ATTENTIONS)[number];

/** When one of the clock's jobs last went through, and last did not. */
export interface WorkerBeat {
  readonly worker: DeploymentWorker;
  readonly everyMs: number;
  readonly lastOkAt: Timestamp | null;
  readonly lastFailedAt: Timestamp | null;
}

/** One run of the backup, as `deploy/backup.sh` recorded it. */
export interface BackupRun {
  readonly result: 'ok' | 'failed';
  readonly finishedAt: Timestamp;
  readonly verified: 'restore' | 'list' | null;
}

export interface DeploymentInput {
  readonly now: Timestamp;
  /** When this process started: the grace for a backup and a worker not yet heard from. */
  readonly startedAt: Timestamp;
  readonly backup: {
    /** `null`: this deployment's backups are not watched here. */
    readonly maxAgeHours: number | null;
    readonly last: BackupRun | null;
    readonly lastOk: BackupRun | null;
  };
  readonly messages: {
    readonly due: number;
    readonly oldestDueAt: Timestamp | null;
  };
  readonly workers: readonly WorkerBeat[];
}

export interface DeploymentSignals {
  readonly backup: {
    readonly watched: boolean;
    readonly lastResult: 'ok' | 'failed' | null;
    readonly lastAt: Timestamp | null;
    readonly lastOkAt: Timestamp | null;
    readonly lastOkVerified: 'restore' | 'list' | null;
    /** Whole hours since the last good one; `null` with none. */
    readonly lastOkHoursAgo: number | null;
  };
  readonly messages: {
    readonly due: number;
    /** Whole minutes the oldest due message has waited; `null` with none. */
    readonly oldestDueMinutes: number | null;
  };
  readonly workers: readonly {
    readonly worker: DeploymentWorker;
    readonly everySeconds: number;
    /** Whole seconds since it last went through; `null` before it has. */
    readonly lastOkSecondsAgo: number | null;
    readonly late: boolean;
  }[];
  readonly attention: readonly DeploymentAttention[];
}

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

function since(now: number, at: Timestamp | null): number | null {
  return at === null ? null : Math.max(0, now - Date.parse(at));
}

export function deploymentSignals(input: DeploymentInput): DeploymentSignals {
  const now = Date.parse(input.now);
  const up = since(now, input.startedAt) ?? 0;
  const attention = new Set<DeploymentAttention>();

  // --- the backup ---
  const { maxAgeHours, last, lastOk } = input.backup;
  const watched = maxAgeHours !== null;
  const okAge = since(now, lastOk?.finishedAt ?? null);
  if (watched) {
    const allowance = maxAgeHours * HOUR_MS;
    if (last?.result === 'failed') attention.add('backup_failed');
    if (okAge !== null && okAge > allowance) attention.add('backup_stale');
    if (last === null && up > allowance) attention.add('backup_none');
  }

  // --- messages ---
  const waited = since(now, input.messages.oldestDueAt);
  if (input.messages.due > 0 && waited !== null && waited > MESSAGE_WAITING_MINUTES * MINUTE_MS) {
    attention.add('messages_overdue');
  }

  // --- the clock's work ---
  const workers = input.workers.map((beat) => {
    const ago = since(now, beat.lastOkAt);
    const quiet = ago ?? up;
    const late = quiet > WORKER_LATE_INTERVALS * beat.everyMs;
    if (late) attention.add('worker_late');
    return {
      worker: beat.worker,
      everySeconds: Math.round(beat.everyMs / 1000),
      lastOkSecondsAgo: ago === null ? null : Math.floor(ago / 1000),
      late,
    };
  });

  return {
    backup: {
      watched,
      lastResult: last?.result ?? null,
      lastAt: last?.finishedAt ?? null,
      lastOkAt: lastOk?.finishedAt ?? null,
      lastOkVerified: lastOk?.verified ?? null,
      lastOkHoursAgo: okAge === null ? null : Math.floor(okAge / HOUR_MS),
    },
    messages: {
      due: input.messages.due,
      oldestDueMinutes: waited === null ? null : Math.floor(waited / MINUTE_MS),
    },
    workers,
    attention: DEPLOYMENT_ATTENTIONS.filter((one) => attention.has(one)),
  };
}
