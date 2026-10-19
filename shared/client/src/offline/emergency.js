import { Outbox, createMemoryOutboxStore } from './outbox.js';

/** In memory: for tests, and for a browser with no IndexedDB (`persistent.js`). */
export function createMemoryErStore() {
  return createMemoryOutboxStore();
}

export class ErOutbox extends Outbox {}
