/**
 * The ward console's offline outbox (`FR-OFF-01`, `SY-02`, `SY-03`).
 *
 * The three answers a flush can get — taken, refused, never arrived — and the
 * one ordering rule that matters: an action that did not arrive holds back
 * every action after it, so a discharge can never overtake the admit it
 * follows.
 */

import { describe, expect, it } from 'vitest';

import {
  BedOutbox,
  createMemoryBedStore,
  type BedSendOutcome,
  type PendingBedAction,
} from '../offline/beds.js';
import { MAX_ATTEMPTS } from '../offline/queue.js';

function action(n: number, hospitalId = 'h1'): Omit<PendingBedAction, 'attempts'> {
  return {
    clientEventId: `00000000-0000-4000-8000-00000000000${String(n)}`,
    hospitalId,
    bedId: 'bed-1',
    path: '/beds/bed-1/clean-start',
    body: {},
    clientTs: `2026-09-21T10:00:0${String(n)}.000Z`,
    change: null,
  };
}

async function outboxWith(...entries: Omit<PendingBedAction, 'attempts'>[]): Promise<BedOutbox> {
  const outbox = new BedOutbox(createMemoryBedStore());
  for (const entry of entries) await outbox.enqueue(entry);
  return outbox;
}

describe('BedOutbox', () => {
  it('sends oldest first and clears what the server took', async () => {
    const outbox = await outboxWith(action(2), action(1), action(3));
    const sent: string[] = [];

    const outcome = await outbox.flush('h1', (entry) => {
      sent.push(entry.clientEventId);
      return Promise.resolve<BedSendOutcome>({ kind: 'accepted' });
    });

    expect(sent).toEqual([
      action(1).clientEventId,
      action(2).clientEventId,
      action(3).clientEventId,
    ]);
    expect(outcome.offline).toBe(false);
    expect(await outbox.pending()).toEqual([]);
  });

  it('drops a refused action and reports it, and still sends the ones after it', async () => {
    const outbox = await outboxWith(action(1), action(2));

    const outcome = await outbox.flush('h1', (entry) =>
      Promise.resolve<BedSendOutcome>(
        entry.clientEventId === action(1).clientEventId
          ? { kind: 'refused', code: 'BED_TRANSITION_INVALID', reason: 'not free' }
          : { kind: 'accepted' },
      ),
    );

    expect(outcome.refused).toEqual([
      {
        clientEventId: action(1).clientEventId,
        code: 'BED_TRANSITION_INVALID',
        reason: 'not free',
      },
    ]);
    expect(outcome.accepted).toEqual([action(2).clientEventId]);
    expect(await outbox.pending()).toEqual([]);
  });

  it('stops at the first action that did not arrive, and keeps it and everything after it in order', async () => {
    const outbox = await outboxWith(action(1), action(2), action(3));

    const outcome = await outbox.flush('h1', (entry) =>
      Promise.resolve<BedSendOutcome>(
        entry.clientEventId === action(1).clientEventId
          ? { kind: 'accepted' }
          : { kind: 'unreachable' },
      ),
    );

    expect(outcome.offline).toBe(true);
    const left = await outbox.pending();
    expect(left.map((entry) => entry.clientEventId)).toEqual([
      action(2).clientEventId,
      action(3).clientEventId,
    ]);
    // A dead network is not a fault of the action and is not counted as one.
    expect(left.every((entry) => entry.attempts === 0)).toBe(true);
    expect(await outbox.stuck()).toHaveLength(0);
  });

  it('holds the order while the server is failing, then sets the action aside (FR-OFF-05)', async () => {
    const outbox = await outboxWith(action(1), action(2));
    const failsOnFirst = (entry: PendingBedAction): Promise<BedSendOutcome> =>
      Promise.resolve<BedSendOutcome>(
        entry.clientEventId === action(1).clientEventId
          ? { kind: 'failed', code: 'INTERNAL' }
          : { kind: 'accepted' },
      );

    // A 500 may be a server restarting: nothing behind it goes ahead of it.
    const first = await outbox.flush('h1', failsOnFirst);
    expect(first.accepted).toEqual([]);
    expect(first.offline).toBe(false);
    expect((await outbox.pending()).map((entry) => entry.attempts)).toEqual([1, 0]);

    // After enough of them it is set aside — kept, not sent, not in the way.
    let last = first;
    for (let i = 1; i < MAX_ATTEMPTS; i += 1) last = await outbox.flush('h1', failsOnFirst);

    expect(last.stuck).toEqual([action(1).clientEventId]);
    expect(last.accepted).toEqual([action(2).clientEventId]);
    expect(await outbox.pending()).toHaveLength(0);
    expect((await outbox.stuck()).map((entry) => entry.clientEventId)).toEqual([
      action(1).clientEventId,
    ]);

    // The operator sends it again, or drops it.
    await outbox.retryStuck();
    expect((await outbox.pending()).map((entry) => entry.attempts)).toEqual([0]);
    await outbox.discard([action(1).clientEventId]);
    expect(await outbox.pending()).toHaveLength(0);
  });

  it('flushes one hospital at a time', async () => {
    const outbox = await outboxWith(action(1, 'h1'), action(2, 'h2'));
    await outbox.flush('h1', () => Promise.resolve<BedSendOutcome>({ kind: 'accepted' }));
    expect((await outbox.pending()).map((entry) => entry.hospitalId)).toEqual(['h2']);
  });
});
