/**
 * The per-route offline outbox, shared by the ward board and the ER console
 * (`FR-OFF-01`, FRONTEND.md §11.1).
 *
 * "Reception, ward, and emergency consoles are offline-first: full read and
 * write capability without internet, with visible offline status and
 * pending-sync count." The queue has its own outbox, built around one
 * session's batch endpoint (`OfflineQueue`). Beds and emergency cases have no
 * batch endpoint: each action is its own route, replay-safe on its own. This
 * is the protocol for that shape, written once, so the two consoles cannot
 * come to disagree about what a flush does.
 *
 * ## What a flush does with each answer
 *
 *   - **accepted** — removed; the server has it.
 *   - **refused** (400, 403, 404, 409, 422) — removed and reported, because it
 *     will be refused however often it is sent; the screen rolls it back
 *     (`SY-03`). The next entry is still sent: a later action may be about
 *     something else entirely.
 *   - **did not arrive** — the flush stops there and everything from that
 *     entry on stays queued, in order. Sending the fourth action while the
 *     third is stuck would apply them out of order.
 *   - **failed** — the server answered with a fault of its own (a 5xx). It may
 *     be restarting, so the flush stops as it does for an entry that did not
 *     arrive. After `MAX_ATTEMPTS` such answers the entry is set aside as
 *     *stuck* — kept, shown, never silently dropped — and stops blocking the
 *     ones behind it.
 */

import { MAX_ATTEMPTS } from './queue.js';

/** In memory: for tests, and for a browser with no IndexedDB. */
export function createMemoryOutboxStore() {
  const rows = new Map();

  return {
    // async without an await: it satisfies the async interface
    async all() {
      return [...rows.values()].sort(byClientTimestamp);
    },
    // async without an await: it satisfies the async interface
    async put(action) {
      rows.set(action.clientEventId, action);
    },
    // async without an await: it satisfies the async interface
    async remove(clientEventIds) {
      for (const id of clientEventIds) rows.delete(id);
    },
    // async without an await: it satisfies the async interface
    async clear() {
      rows.clear();
    },
  };
}

export class Outbox {
  store;
  constructor(store) {
    this.store = store;
  }

  /** Everything still waiting to go, oldest first. Stuck entries are not. */
  async pending() {
    return (await this.store.all()).filter((action) => action.stuck === undefined);
  }

  async enqueue(action) {
    await this.store.put({ ...action, attempts: 0 });
  }

  /** Sends everything queued for one hospital, oldest first. */
  async flush(hospitalId, send) {
    const queued = (await this.pending()).filter((action) => action.hospitalId === hospitalId);

    const accepted = [];
    const answers = [];
    const refused = [];
    const stuck = [];
    const settle = async () => {
      await this.store.remove([...accepted, ...refused.map((entry) => entry.clientEventId)]);
    };

    for (const action of queued) {
      const outcome = await send(action);

      if (outcome.kind === 'unreachable') {
        // Everything from here on waits, in order. A dead network is not a
        // fault of the entry and is not counted against it.
        await settle();
        return { accepted, answers, refused, stuck, offline: true };
      }

      if (outcome.kind === 'failed') {
        const attempts = action.attempts + 1;
        if (attempts < MAX_ATTEMPTS) {
          // The server may be restarting. Nothing behind it goes out of order.
          await this.store.put({ ...action, attempts });
          await settle();
          return { accepted, answers, refused, stuck, offline: false };
        }

        await this.store.put({ ...action, attempts, stuck: { code: outcome.code } });
        stuck.push(action.clientEventId);
        continue;
      }

      if (outcome.kind === 'accepted') {
        accepted.push(action.clientEventId);
        if (outcome.answer !== undefined) {
          answers.push({ clientEventId: action.clientEventId, answer: outcome.answer });
        }
      } else {
        refused.push({
          clientEventId: action.clientEventId,
          code: outcome.code,
          reason: outcome.reason,
        });
      }
    }

    await settle();
    return { accepted, answers, refused, stuck, offline: false };
  }

  /** Entries the server could not take, for the operator to act on. */
  async stuck() {
    return (await this.store.all()).filter((action) => action.stuck !== undefined);
  }

  /** Drops entries the operator has chosen not to send. */
  async discard(clientEventIds) {
    await this.store.remove(clientEventIds);
  }

  /** Puts stuck entries back in the outbox to be sent again, in their place. */
  async retryStuck() {
    for (const action of await this.stuck()) {
      const { stuck: _stuck, ...rest } = action;
      await this.store.put({ ...rest, attempts: 0 });
    }
  }

  async clear() {
    await this.store.clear();
  }
}

function byClientTimestamp(a, b) {
  if (a.clientTs === b.clientTs) return a.clientEventId < b.clientEventId ? -1 : 1;
  return a.clientTs < b.clientTs ? -1 : 1;
}
