/**
 * The offline queue (`FR-OFF-01`, FRONTEND.md §11.1).
 *
 * This is the half of step 8's definition of done — "offline actions queue and
 * sync on reconnect" — that can be proven without a browser. Each test is a
 * moment in a receptionist's shift where the network is not cooperating.
 */

import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/client.js';
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

/** A server that answers, and cannot take a batch holding any of `keys`. */
function chokesOn(keys: readonly string[], status: number): PushTransport {
  return (sessionId, events) =>
    events.some((event) => keys.includes(event.clientEventId))
      ? Promise.reject(new ApiError(status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED', 'no', status))
      : acceptsAll(sessionId, events);
}

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
  it('keeps everything queued, and does not hold a dead network against it', async () => {
    const queue = makeQueue();
    await queue.enqueue(action('a', 'DOCTOR_ARRIVED', 4));

    const outcome = await queue.flush(SESSION, offline);

    // This is the whole point: a dropped connection costs nothing.
    expect(outcome.offline).toBe(true);
    expect(await queue.pendingCount()).toBe(1);
    expect((await queue.pending())[0]?.attempts).toBe(0);
  });

  it('is never "stuck" for having been offline, however long', async () => {
    const queue = makeQueue();
    await queue.enqueue(action('a', 'DOCTOR_ARRIVED', 4));

    // An hour without a network is an hour of retries. None of them is a
    // fault of the action, and a shift's work must not be flagged for it.
    for (let i = 0; i < MAX_ATTEMPTS * 3; i += 1) await queue.flush(SESSION, offline);

    expect(await queue.pendingCount()).toBe(1);
    expect(await queue.stuck()).toHaveLength(0);
  });

  it('treats "not now" from the server as it treats no server', async () => {
    const queue = makeQueue();
    await queue.enqueue(action('a', 'DOCTOR_ARRIVED', 4));

    // An access token that ran out while the counter was offline.
    const expired: PushTransport = () =>
      Promise.reject(new ApiError('AUTH_TOKEN_INVALID', 'expired', 401));
    for (let i = 0; i < MAX_ATTEMPTS + 1; i += 1) {
      expect((await queue.flush(SESSION, expired)).offline).toBe(true);
    }

    expect(await queue.pendingCount()).toBe(1);
    expect(await queue.stuck()).toHaveLength(0);
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

describe('an entry the server cannot take (FR-OFF-05)', () => {
  it('is set aside at once when it will never be taken, and the rest are sent', async () => {
    const queue = makeQueue();
    await queue.enqueue(action('a', 'DOCTOR_ARRIVED', 3));
    await queue.enqueue(action('bad', 'PATIENT_CALLED', 2));
    await queue.enqueue(action('c', 'PATIENT_LATE', 1));

    // The batch as a whole is refused; one entry in it is the reason.
    const outcome = await queue.flush(SESSION, chokesOn(['bad'], 400));

    expect(outcome.accepted).toEqual(['a', 'c']);
    expect(outcome.stuck).toEqual(['bad']);
    expect(outcome.offline).toBe(false);

    // Nothing waits behind it any more, and it has not been thrown away.
    expect(await queue.pendingCount()).toBe(0);
    const stuck = await queue.stuck();
    expect(stuck.map((event) => event.clientEventId)).toEqual(['bad']);
    expect(stuck[0]?.stuck).toEqual({ code: 'VALIDATION_FAILED' });
  });

  it('is not sent again once it is stuck', async () => {
    const queue = makeQueue();
    await queue.enqueue(action('bad', 'PATIENT_CALLED', 2));
    await queue.flush(SESSION, chokesOn(['bad'], 422));

    const push = vi.fn(acceptsAll);
    await queue.enqueue(action('next', 'PATIENT_DONE', 1));
    await queue.flush(SESSION, push);

    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]?.[1].map((event) => event.clientEventId)).toEqual(['next']);
  });

  it('keeps its place while the server may only be restarting', async () => {
    const queue = makeQueue();
    await queue.enqueue(action('a', 'DOCTOR_ARRIVED', 3));
    await queue.enqueue(action('b', 'PATIENT_CALLED', 2));

    // A 500: possibly a database restarting. Order still matters, so nothing
    // behind the entry that failed is sent ahead of it.
    const outcome = await queue.flush(SESSION, chokesOn(['a'], 500));

    expect(outcome.accepted).toEqual([]);
    expect(outcome.stuck).toEqual([]);
    expect((await queue.pending()).map((event) => event.clientEventId)).toEqual(['a', 'b']);
    expect((await queue.pending())[0]?.attempts).toBe(1);

    // And when the server is well again, everything goes, in order.
    const recovered = await queue.flush(SESSION, acceptsAll);
    expect(recovered.accepted).toEqual(['a', 'b']);
  });

  it('stops blocking the queue after the server has failed it enough times', async () => {
    const queue = makeQueue();
    await queue.enqueue(action('poison', 'DOCTOR_ARRIVED', 3));
    await queue.enqueue(action('b', 'PATIENT_CALLED', 2));

    // This used to be forever: one entry the server kept failing on, retried
    // as though the network were down, with a shift's work behind it.
    const failing = chokesOn(['poison'], 500);
    for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1) {
      expect((await queue.flush(SESSION, failing)).accepted).toEqual([]);
    }
    const last = await queue.flush(SESSION, failing);

    expect(last.stuck).toEqual(['poison']);
    expect(last.accepted).toEqual(['b']);
    expect(await queue.pendingCount()).toBe(0);
    expect((await queue.stuck()).map((event) => event.clientEventId)).toEqual(['poison']);
  });

  it('goes back in line, in its place, when the operator sends it again', async () => {
    const queue = makeQueue();
    await queue.enqueue(action('bad', 'PATIENT_CALLED', 5));
    await queue.flush(SESSION, chokesOn(['bad'], 400));
    await queue.enqueue(action('later', 'PATIENT_DONE', 1));

    await queue.retryStuck();

    expect(await queue.stuck()).toHaveLength(0);
    const outcome = await queue.flush(SESSION, acceptsAll);
    expect(outcome.accepted).toEqual(['bad', 'later']);
  });

  it('is gone, and never sent, when the operator discards it', async () => {
    const queue = makeQueue();
    await queue.enqueue(action('bad', 'PATIENT_CALLED', 5));
    await queue.flush(SESSION, chokesOn(['bad'], 400));

    await queue.discard(['bad']);

    expect(await queue.stuck()).toHaveLength(0);
    const push = vi.fn(acceptsAll);
    await queue.flush(SESSION, push);
    expect(push).not.toHaveBeenCalled();
  });
});

describe('what an earlier page left behind (FR-OFF-01)', () => {
  it('names every chamber with work still waiting', async () => {
    const queue = makeQueue();
    const other = '22222222-2222-7222-8222-222222222222';
    await queue.enqueue(action('a', 'PATIENT_CALLED', 3));
    await queue.enqueue(action('b', 'PATIENT_DONE', 2, other));
    await queue.enqueue(action('c', 'PATIENT_LATE', 1, other));

    expect((await queue.sessions()).sort()).toEqual([SESSION, other].sort());

    await queue.flush(other, acceptsAll);
    expect(await queue.sessions()).toEqual([SESSION]);
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

describe('taking an action back (GR-02)', () => {
  it('reports which event each accepted action became, so it can be undone by id', async () => {
    const queue = makeQueue();
    await queue.enqueue(action('a', 'PATIENT_DONE', 2));
    await queue.enqueue(action('b', 'PATIENT_CALLED', 1));

    const outcome = await queue.flush(SESSION, (_sessionId, events) =>
      Promise.resolve({
        accepted: events.map((event) => ({
          clientEventId: event.clientEventId,
          eventId: `event-${event.clientEventId}`,
        })),
        conflicts: [],
      }),
    );

    expect(outcome.acceptedEvents).toEqual([
      { clientEventId: 'a', eventId: 'event-a' },
      { clientEventId: 'b', eventId: 'event-b' },
    ]);
  });

  it('drops an action that was never sent, and sends the rest', async () => {
    const queue = makeQueue();
    await queue.enqueue(action('a', 'PATIENT_DONE', 3));
    await queue.enqueue(action('b', 'PATIENT_CALLED', 2));
    await queue.enqueue(action('c', 'PATIENT_LATE', 1));

    // Offline, so nothing has left the device: undo is simply not sending it.
    expect(await queue.discard(['b', 'missing'])).toEqual(['b']);

    const sent: string[] = [];
    await queue.flush(SESSION, (_sessionId, events) => {
      sent.push(...events.map((event) => event.clientEventId));
      return acceptsAll(_sessionId, events);
    });

    expect(sent).toEqual(['a', 'c']);
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
