/**
 * Whose outbox is whose (`FR-OFF-01`, `FR-QUE-04`).
 *
 * The outboxes are kept on the device, and a counter PC is shared. What keeps
 * one person's unsent work from being sent under another's sign-in is that
 * each person has a database of their own, named from their token — so the
 * naming is tested here, and the behaviour in a browser by
 * `offline-console.spec.ts`.
 */

import { describe, expect, it } from 'vitest';

import { consoleDatabaseName, openConsoleStores, ownerOfToken } from '../offline/persistent.js';

/** A token shaped like the API's, with only the payload that matters here. */
function tokenFor(payload: Record<string, unknown>): string {
  const encode = (value: unknown): string =>
    globalThis
      .btoa(JSON.stringify(value))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');
  return `${encode({ alg: 'HS256' })}.${encode(payload)}.signature`;
}

const AFTERNOON = '01900000-0000-7000-8000-00000000000a';
const EVENING = '01900000-0000-7000-8000-00000000000b';

describe('the owner of an outbox', () => {
  it('is the person the token names', () => {
    expect(ownerOfToken(tokenFor({ sub: AFTERNOON, kind: 'staff' }))).toBe(AFTERNOON);
  });

  it('gives two people on one PC two databases', () => {
    const afternoon = consoleDatabaseName(ownerOfToken(tokenFor({ sub: AFTERNOON })));
    const evening = consoleDatabaseName(ownerOfToken(tokenFor({ sub: EVENING })));

    expect(afternoon).not.toBe(evening);
    expect(afternoon).toBe(`healthcare-console-${AFTERNOON}`);
  });

  it('gives the same person the same database at every sign-in', () => {
    // A new token after a refresh, the same person: the same unsent work.
    const before = ownerOfToken(tokenFor({ sub: AFTERNOON, exp: 1 }));
    const after = ownerOfToken(tokenFor({ sub: AFTERNOON, exp: 2, roles: ['receptionist'] }));

    expect(after).toBe(before);
  });

  it('opens nobody’s outbox for a token it cannot read', () => {
    // Never another person's: an unreadable token must not fall through to
    // some shared default that the last receptionist's work is sitting in.
    for (const token of [null, '', 'not-a-token', 'a.b.c', tokenFor({}), tokenFor({ sub: 42 })]) {
      expect(ownerOfToken(token)).toBe('nobody');
    }
    // Nor a name that could reach outside its own database.
    expect(ownerOfToken(tokenFor({ sub: '../somebody-else' }))).toBe('nobody');
  });
});

describe('with no IndexedDB (a server render, a locked-down browser)', () => {
  it('still gives a working outbox, and says it will not survive a reload', async () => {
    const stores = openConsoleStores(AFTERNOON);

    expect(stores.durable()).toBe(false);
    await stores.queue.put({
      clientEventId: 'a',
      sessionId: 's',
      type: 'PATIENT_CALLED',
      payload: {},
      clientTs: '2026-10-03T00:00:00.000Z',
      attempts: 0,
    });
    expect(await stores.queue.all()).toHaveLength(1);
  });

  it('remembers nothing between one render and the next', async () => {
    // On the server a shared cache would leak one request's outbox into
    // another's, so without IndexedDB every call starts empty.
    const first = openConsoleStores(AFTERNOON);
    await first.queue.put({
      clientEventId: 'a',
      sessionId: 's',
      type: 'PATIENT_CALLED',
      payload: {},
      clientTs: '2026-10-03T00:00:00.000Z',
      attempts: 0,
    });

    expect(await openConsoleStores(AFTERNOON).queue.all()).toHaveLength(0);
  });
});
