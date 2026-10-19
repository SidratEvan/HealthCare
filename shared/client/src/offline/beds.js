import { Outbox, createMemoryOutboxStore } from './outbox.js';

/** In memory: for tests, and for a browser with no IndexedDB (`persistent.js`). */
export function createMemoryBedStore() {
  return createMemoryOutboxStore();
}

export class BedOutbox extends Outbox {}
