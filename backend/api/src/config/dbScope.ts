/**
 * Who a database connection is working for (`PRD.md` `FR-SEC-11`,
 * `FR-NET-02`; DATABASE.md §5.2 and §5.3; migrations 0043 and 0044; plans B1
 * and B3).
 *
 * Hospitals used to be kept apart by habits in application code: a scope
 * check on each route, a hospital in each query. One forgotten check leaked
 * across hospitals and nothing underneath stopped it. Now the database is told
 * who every connection is working for, and its policies refuse a member of
 * staff any row of another hospital, whatever the query forgot to say.
 *
 * ## How the scope travels
 *
 * A request's scope is decided once, from its principal, by the middleware in
 * `app.ts`, and held for the length of the request by `AsyncLocalStorage`:
 * every `await` of that request sees it, and no other request's. Each time a
 * connection is taken from the pool (`config/db.ts`), the scope in force is
 * stated on it before anything else runs. A transaction takes one connection
 * and keeps it, so it is stated once.
 *
 * No route, service or repository says anything about scope, and none can
 * forget to. That is the point.
 *
 * ## The scopes
 *
 * - `hospital`: a member of that hospital's staff. Another hospital's rows do
 *   not exist for it.
 * - `national`: a platform administrator. Organisations, never a patient
 *   (`FR-ONB-08`).
 * - `patient`: a signed-in account. Of the clinical record (visits, test
 *   orders, reports, consents and the rest; migration 0044) it reaches its
 *   own profiles' and nobody else's.
 * - `guest`: a tracking link, or the short token it is exchanged for. Of the
 *   clinical record it reaches what was written at the one booking it names
 *   (`FR-GST-05`). A guest token that names no booking reaches none.
 * - `open`: nobody. Of the clinical record, nothing; of bookings, payments,
 *   messages, links, standby places and profiles (migration 0056), likewise
 *   nothing, where an account and a link reach their own. What a person is
 *   told of a whole chamber comes through the queue (`asQueue`).
 * - `system`: the server's own work with nobody behind it — the schedule job,
 *   the purge, a command an operator runs — and any code that runs outside a
 *   request, which is what makes this the value when nothing was said.
 *
 * `system` as the default is deliberate and is not the weak point it may look
 * like. Nothing a request does runs outside its own scope: the middleware
 * wraps the whole of it. What runs with no scope is code no caller reaches.
 * And a connection the API never stated anything on — somebody connecting as
 * the API's role by hand — has no scope at all, and the policies show it
 * nothing.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import type { Principal } from '../types/express.js';

export type DbScope =
  | { readonly kind: 'hospital'; readonly hospitalId: string }
  | { readonly kind: 'national' }
  | { readonly kind: 'patient'; readonly userId: string }
  | { readonly kind: 'guest'; readonly guestId: string; readonly bookingId: string | null }
  | { readonly kind: 'open' }
  | { readonly kind: 'system' };

const SYSTEM: DbScope = { kind: 'system' };
const OPEN: DbScope = { kind: 'open' };
const NATIONAL: DbScope = { kind: 'national' };

const storage = new AsyncLocalStorage<DbScope>();

/** Runs `body`, and everything it awaits, in `scope`. */
export function runInDbScope<T>(scope: DbScope, body: () => T): T {
  return storage.run(scope, body);
}

/** The scope in force here; `system` where nothing set one. */
export function currentDbScope(): DbScope {
  return storage.getStore() ?? SYSTEM;
}

/**
 * Runs the queue's own work for a person as the server's (migration 0056,
 * DATABASE.md §5.4, plan I3).
 *
 * A patient, a link and nobody reach their own bookings, payments, messages
 * and profiles and nobody else's. The queue cannot work that way: a serial is
 * allocated against every booking in a chamber, a log is reduced over all of
 * them, and every phone in the room is told where it now stands. So when a
 * person asks the queue to act (to book, cancel, say they are late, take a
 * freed chair) or to say where they stand, the queue does it as the server,
 * and only after the application has decided the request is theirs to make.
 * What leaves it for a person is the patients' copy, which names nobody
 * (plan I2c).
 *
 * A member of staff, the platform and the server's own work are left in
 * their own scope: a hospital's request is still held to its hospital by the
 * database, inside the queue as outside it.
 */
export function asQueue<T>(body: () => T): T {
  const scope = currentDbScope();
  return scope.kind === 'patient' || scope.kind === 'guest' || scope.kind === 'open'
    ? storage.run(SYSTEM, body)
    : body();
}

/**
 * The scope a principal works in.
 *
 * A member of staff is scoped to the hospital their token names, and to
 * nothing else: the token's `hospitalId` is the only thing consulted, never
 * anything the request says. An account is scoped to itself, and a link to
 * the booking its token names, in the same way.
 */
export function scopeOfPrincipal(principal: Principal | undefined): DbScope {
  if (principal === undefined) return OPEN;
  switch (principal.kind) {
    case 'staff':
      return { kind: 'hospital', hospitalId: principal.hospitalId };
    case 'national':
      return NATIONAL;
    case 'patient':
      return { kind: 'patient', userId: principal.id };
    case 'guest':
      return { kind: 'guest', guestId: principal.id, bookingId: principal.bookingId };
  }
}

/** What is said to the database, and the key that tells two scopes apart. */
export function statementOf(scope: DbScope): {
  readonly scope: string;
  readonly hospitalId: string;
  /** The account, or the identity a link was issued to. */
  readonly personId: string;
  readonly bookingId: string;
} {
  const nothing = { hospitalId: '', personId: '', bookingId: '' };
  switch (scope.kind) {
    case 'hospital':
      return { ...nothing, scope: scope.kind, hospitalId: scope.hospitalId };
    case 'patient':
      return { ...nothing, scope: scope.kind, personId: scope.userId };
    case 'guest':
      return {
        ...nothing,
        scope: scope.kind,
        personId: scope.guestId,
        bookingId: scope.bookingId ?? '',
      };
    case 'national':
    case 'open':
    case 'system':
      return { ...nothing, scope: scope.kind };
  }
}
