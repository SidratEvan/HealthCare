/**
 * When each piece of the server's work on a clock last went through (plan I2;
 * `shared/domain` `org/deployment`).
 *
 * The sender, the offer timer and the hourly jobs each catch their own
 * failure, log it and try again on the next tick. That is right for a
 * passing fault and silent for a lasting one: a sender whose every pass fails
 * looks, from outside, exactly like a sender with nothing to send. So each
 * says here how its pass went, and `/readyz` reads it.
 *
 * In memory, for this process. A worker belongs to the process that runs it,
 * and a process that has stopped answers nothing at all.
 */

import {
  timestamp,
  type DeploymentWorker,
  type Timestamp,
  type WorkerBeat,
} from '@platform/domain';

const beats = new Map<
  DeploymentWorker,
  { lastOkAt: Timestamp | null; lastFailedAt: Timestamp | null }
>();
const intervals = new Map<DeploymentWorker, number>();

/** A worker says how often it runs, when it starts. */
export function register(worker: DeploymentWorker, everyMs: number): void {
  intervals.set(worker, everyMs);
}

/** A pass finished: `ok` when nothing in it failed. */
export function beat(worker: DeploymentWorker, ok: boolean, at: Date = new Date()): void {
  const now = timestamp(at.toISOString());
  const last = beats.get(worker) ?? { lastOkAt: null, lastFailedAt: null };
  beats.set(worker, ok ? { ...last, lastOkAt: now } : { ...last, lastFailedAt: now });
}

/** Every registered worker, in the order they were started. */
export function snapshot(): WorkerBeat[] {
  return [...intervals].map(([worker, everyMs]) => ({
    worker,
    everyMs,
    lastOkAt: beats.get(worker)?.lastOkAt ?? null,
    lastFailedAt: beats.get(worker)?.lastFailedAt ?? null,
  }));
}

/** Forgets everything. For a test. */
export function reset(): void {
  beats.clear();
  intervals.clear();
}
