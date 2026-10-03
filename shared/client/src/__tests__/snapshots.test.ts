/**
 * The queue a console was last told, kept so it can open with no network
 * (`FR-OFF-01`, `FR-OFF-03`).
 *
 * Three questions, each of which is somebody at a counter during an outage:
 * is what I am shown the queue I was last told; is it shown as old as it is;
 * and when the server comes back, can an older answer push me backwards.
 */

import { describe, expect, it } from 'vitest';

import type { QueueState } from '@platform/domain';

import {
  MAX_KEPT_HOURS,
  createMemorySnapshotStore,
  isUsable,
  readKept,
  type KeptSnapshot,
  type SnapshotStore,
} from '../offline/snapshots.js';
import { foldUpdate, startingFrom } from '../realtime/session.js';

const SESSION = '11111111-1111-7111-8111-111111111111';
const NOW = new Date('2026-10-03T12:00:00.000Z');

/** Only the sequence matters to what is tested here. */
const stateAt = (seq: number): QueueState => ({ lastSeq: seq }) as unknown as QueueState;

function kept(hoursAgo: number, seq = 40): KeptSnapshot {
  const at = new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
  return {
    sessionId: SESSION,
    state: stateAt(seq),
    etas: [],
    lastServerTs: at,
    lastSeq: seq,
    keptAt: at,
  };
}

describe('how long a kept queue is worth showing (SY-06)', () => {
  it('opens the console on one from this shift', () => {
    expect(isUsable(kept(0.5), NOW)).toBe(true);
    expect(isUsable(kept(MAX_KEPT_HOURS - 1), NOW)).toBe(true);
  });

  it('lets go of yesterday’s chamber', () => {
    expect(isUsable(kept(MAX_KEPT_HOURS), NOW)).toBe(false);
    expect(isUsable(kept(72), NOW)).toBe(false);
  });

  it('does not trust one stamped in the future, or not stamped at all', () => {
    // A device whose clock was wrong when it kept this cannot say how old it is.
    expect(isUsable(kept(-2), NOW)).toBe(false);
    expect(isUsable({ ...kept(1), keptAt: 'not a date' }, NOW)).toBe(false);
  });
});

describe('reading what was kept', () => {
  it('returns the chamber’s own queue, and nobody else’s', async () => {
    const store = createMemorySnapshotStore();
    await store.put(kept(1, 40));
    await store.put({ ...kept(1, 7), sessionId: 'another-chamber' });

    expect((await readKept(store, SESSION, NOW))?.lastSeq).toBe(40);
    expect(await readKept(store, 'a-chamber-never-opened', NOW)).toBeNull();
  });

  it('keeps one per chamber: the newest it was told', async () => {
    const store = createMemorySnapshotStore();
    await store.put(kept(2, 40));
    await store.put(kept(1, 44));

    expect((await readKept(store, SESSION, NOW))?.lastSeq).toBe(44);
  });

  it('drops one that is too old, rather than showing it', async () => {
    const store = createMemorySnapshotStore();
    await store.put(kept(30));

    expect(await readKept(store, SESSION, NOW)).toBeNull();
    // Gone from the device, not merely skipped this once.
    expect(await store.get(SESSION)).toBeNull();
  });

  it('opens on nothing when the storage cannot be read', async () => {
    // The console must still open, as it always did, on what the server says.
    const broken: SnapshotStore = {
      get: () => Promise.reject(new Error('the database is closed')),
      put: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    };

    expect(await readKept(broken, SESSION, NOW)).toBeNull();
  });
});

describe('a channel that starts from what was kept', () => {
  it('starts with nothing, and not connected, when nothing was kept', () => {
    const start = startingFrom(undefined);

    expect(start.snapshot.state).toBeNull();
    expect(start.snapshot.connected).toBe(false);
    expect(start.snapshot.lastSeq).toBe(0);
  });

  it('shows the kept queue with its own timestamp, and still says it is not connected', () => {
    const was = kept(3, 40);
    const start = startingFrom({
      state: was.state,
      etas: was.etas,
      lastServerTs: was.lastServerTs,
      lastSeq: was.lastSeq,
    });

    // The freshness line counts from the server's stamp, not from the reload:
    // three hours old is shown as three hours old (`FR-OFF-03`).
    expect(start.snapshot.lastServerTs).toBe(was.lastServerTs);
    expect(start.snapshot.connected).toBe(false);
    // The first subscribe resumes from here instead of asking for everything.
    expect(start.snapshot.lastSeq).toBe(40);
  });

  it('is never pushed backwards by an older answer from the server', () => {
    const was = kept(1, 40);
    const start = startingFrom({
      state: was.state,
      etas: [],
      lastServerTs: was.lastServerTs,
      lastSeq: 40,
    });

    const older = foldUpdate(start.snapshot, start.stateSeq, {
      seq: 38,
      serverTs: NOW.toISOString(),
      data: { state: stateAt(38), etas: [] },
    });
    expect(older).toBeNull();

    const newer = foldUpdate(start.snapshot, start.stateSeq, {
      seq: 43,
      serverTs: NOW.toISOString(),
      data: { state: stateAt(43), etas: [] },
    });
    expect(newer?.snapshot.state?.lastSeq).toBe(43);
    expect(newer?.snapshot.lastServerTs).toBe(NOW.toISOString());
  });
});
