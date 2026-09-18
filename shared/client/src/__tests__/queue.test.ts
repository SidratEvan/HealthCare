/**
 * The offline queue (`FR-OFF-01`, FRONTEND.md §11.1).
 *
 * This is the half of step 8's definition of done — "offline actions queue and
 * sync on reconnect" — that can be proven without a browser. Each test is a
 * moment in a receptionist's shift where the network is not cooperating.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  MAX_ATTEMPTS,
  OfflineQueue,
  createMemoryStore,
  retryDelayMs,
  type PendingEvent,
  type PushTransport,
} from '../offline/queue.js';

const SESSION = '11111111-1111-7111-8111-111111111111';

function action(
  key: string,
  type: PendingEvent['type'],
  minutesAgo: number,
  sessionId = SESSION,
): Omit<PendingEvent, 'attempts'> {
  return {
    clientEventId: key,
    sessionId,
    type,
    payload: {},
    clientTs: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  };
}

function makeQueue(): OfflineQueue {
  return new OfflineQueue(createMemoryStore());
}

/** A transport that takes everything. */
const acceptsAll: PushTransport = (_sessionId, events) =>
  Promise.resolve({
    accepted: events.map((event) => ({ clientEventId: event.clientEventId })),
    conflicts: [],
  });

/** A transport with no network behind it. */
const offline: PushTransport = () => Promise.reject(new Error('Failed to fetch'));

describe('queuing while offline', () => {
  it('keeps actions in the order they were taken', async () => {
    const queue = makeQueue();

    // Enqueued out of order, as a burst of taps can arrive.
    await queue.enqueue(action('b', 'PATIENT_CALLED', 8));
    await queue.enqueue(action('a', 'DOCTOR_ARRIVED', 10));
    await queue.enqueue(action('c', 'PATIENT_DONE', 5));

    const pending = await queue.pending();
    expect(pending.map((event) => event.clientEventId)).toEqual(['a', 'b', 'c']);
  });

  it('counts what is waiting, for the offline block', async () => {
    const queue = makeQueue();
    expect(await queue.pendingCount()).toBe(0);

    await queue.enqueue(action('a', 'DOCTOR_ARRIVED', 3));
    await queue.enqueue(action('b', 'SESSION_PAUSED', 2));

    expect(await queue.pendingCount()).toBe(2);
  });

  it('records every action with a key and a client timestamp', async () => {
    const queue = makeQueue();
    await queue.enqueue(action('a', 'DOCTOR_ARRIVED', 1));

    const [event] = await queue.pending();
    expect(event?.clientEventId).toBe('a');
    expect(event?.clientTs).toBeTruthy();
    expect(event?.attempts).toBe(0);
  });
});

describe('flushing on reconnect', () => {
  it('sends everything queued and empties the queue', async () => {
    const queue = makeQueue();
    await queue.enqueue(action('a', 'DOCTOR_ARRIVED', 10));
    await queue.enqueue(action('b', 'PATIENT_CALLED', 9));

    const push = vi.fn(acceptsAll);
    const outcome = await queue.flush(SESSION, push);

    expect(outcome.offline).toBe(false);
    expect(outcome.accepted).toEqual(['a', 'b']);
    expect(await queue.pendingCount()).toBe(0);

    // One batch, not one request per action.
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]?.[1]).toHaveLength(2);
  });

  it('sends the batch in client-timestamp order (SY-01)', async () => {
    const queue = makeQueue();
    await queue.enqueue(action('later', 'PATIENT_CALLED', 2));
    await queue.enqueue(action('earlier', 'DOCTOR_ARRIVED', 20));

    const push = vi.fn(acceptsAll);
    await queue.flush(SESSION, push);

    const sent = push.mock.calls[0]?.[1] ?? [];
    expect(sent.map((event) => event.clientEventId)).toEqual(['earlier', 'later']);
  });

  it('only sends the session it was asked about', async () => {
    const queue = makeQueue();
    await queue.enqueue(action('mine', 'DOCTOR_ARRIVED', 5));
    await queue.enqueue(action('theirs', 'DOCTOR_ARRIVED', 5, 'other-session'));

    const push = vi.fn(acceptsAll);
    await queue.flush(SESSION, push);

    expect(push.mock.calls[0]?.[1].map((event) => event.clientEventId)).toEqual(['mine']);
    // The other session's action is untouched, still waiting its turn.
    expect(await queue.pendingCount()).toBe(1);
  });

  it('does not call the server when there is nothing to send', async () => {
    const push = vi.fn(acceptsAll);
    const outcome = await makeQueue().flush(SESSION, push);

    expect(push).not.toHaveBeenCalled();
    expect(outcome.offline).toBe(false);
  });
});

describe('a push that never lands', () => {
  it('keeps everything queued and counts the attempt', async () => {
    const queue = makeQueue();
    await queue.enqueue(action('a', 'DOCTOR_ARRIVED', 4));

    const outcome = await queue.flush(SESSION, offline);

    // This is the whole point: a dropped connection costs nothing.
    expect(outcome.offline).toBe(true);
    expect(await queue.pendingCount()).toBe(1);
    expect((await queue.pending())[0]?.attempts).toBe(1);
  });

  it('accumulates attempts across retries and reports what is stuck', async () => {
    const queue = makeQueue();
    await queue.enqueue(action('a', 'DOCTOR_ARRIVED', 4));

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) await queue.flush(SESSION, offline);

    // Never discarded. An action a receptionist took and the system silently
    // dropped is the worst outcome this design can produce, so it is surfaced
    // instead.
    expect(await queue.pendingCount()).toBe(1);
    expect(await queue.stuck()).toHaveLength(1);
  });

  it('succeeds once the network returns, with nothing lost', async () => {
    const queue = makeQueue();
    await queue.enqueue(action('a', 'DOCTOR_ARRIVED', 12));
    await queue.enqueue(action('b', 'PATIENT_CALLED', 11));

    await queue.flush(SESSION, offline);
    await queue.flush(SESSION, offline);
    expect(await queue.pendingCount()).toBe(2);

    const outcome = await queue.flush(SESSION, acceptsAll);
    expect(outcome.accepted).toEqual(['a', 'b']);
    expect(await queue.pendingCount()).toBe(0);
  });
});

describe('a conflicted entry (SY-03)', () => {
  it('is removed and reported, so the row can roll back', async () => {
    const queue = makeQueue();
    await queue.enqueue(action('won', 'SESSION_PAUSED', 6));
    await queue.enqueue(action('lost', 'DOCTOR_ARRIVED', 7));

    const push: PushTransport = () =>
      Promise.resolve({
        accepted: [{ clientEventId: 'won' }],
        conflicts: [
          { clientEventId: 'lost', reason: 'The doctor has already arrived.', code: 'ALREADY' },
        ],
      });

    const outcome = await queue.flush(SESSION, push);

    expect(outcome.accepted).toEqual(['won']);
    expect(outcome.conflicted).toEqual([
      { clientEventId: 'lost', reason: 'The doctor has already arrived.' },
    ]);

    // Both leave the queue. A refused entry lost a race that is already over
    // and will never be accepted, however many times it is sent.
    expect(await queue.pendingCount()).toBe(0);
  });
});

describe('retry backoff', () => {
  it('grows exponentially from one second', () => {
    expect(retryDelayMs(0)).toBe(1_000);
    expect(retryDelayMs(1)).toBe(2_000);
    expect(retryDelayMs(2)).toBe(4_000);
  });

  it('caps at thirty seconds', () => {
    // The cap matters more than the curve: a console offline for an hour must
    // notice the network within half a minute of it returning, or a
    // receptionist stands there watching a count that will not move.
    expect(retryDelayMs(20)).toBe(30_000);
  });
});

describe('a forced re-pull (SY-06)', () => {
  it('discards the local queue', async () => {
    const queue = makeQueue();
    await queue.enqueue(action('a', 'DOCTOR_ARRIVED', 1));
    await queue.clear();
    expect(await queue.pendingCount()).toBe(0);
  });
});
