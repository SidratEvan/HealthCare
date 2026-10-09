/**
 * The socket handshake (BACKEND.md §6).
 *
 * "JWT (staff/patient) or a guest-link token. A socket may only join rooms its
 * principal is scoped to."
 *
 * The same `verifyToken` and `toPrincipal` the HTTP middleware uses, for a
 * reason worth being explicit about: a second way of deciding who somebody is
 * would eventually disagree with the first, and the one that is easier to get
 * past is the one an attacker would use. A socket connection is not a lesser
 * door than a request.
 *
 * A connection with no valid credential is refused outright rather than
 * admitted anonymously. There is nothing on this server a socket needs to hear
 * without being somebody: public data is fetched over HTTP.
 *
 * ## A connection does not outlive the access behind it (`FR-SEC-06`, plan A6)
 *
 * A handshake is checked once and a connection lasts a shift. So a staff
 * connection is closed when its access ends, by three roads:
 *
 * - **at once**, when access is ended in this process — a sign-out, a
 *   deactivation, a password reset (`accessGuard.service`);
 * - **within a minute**, when it is ended some other way — a command run on
 *   the server, another instance (`sweepRevoked`, on a timer);
 * - **at the handshake**, when a revoked token tries to connect again.
 */

import { verifyToken } from '../config/jwt.js';
import { toPrincipal } from '../middleware/auth.js';
import { staffAccessLive } from '../services/staffAccess.service.js';

import type { Principal } from '../types/express.js';
import type { Socket } from 'socket.io';

/** What a connected socket carries once the handshake has passed. */
export interface SocketSession {
  readonly principal: Principal;
  /** Rooms joined so far, so a resume does not re-join blindly. */
  readonly rooms: Set<string>;
  /** The staff account behind the connection; null for a patient or a guest. */
  readonly staffId: string | null;
  /** The sign-in it came from (`sid`); null when the token named none. */
  readonly familyId: string | null;
  /** Closes the connection from this side. */
  readonly close: () => void;
}

/** Sockets that have completed the handshake, by socket id. */
const sessions = new Map<string, SocketSession>();

export function sessionOf(socket: Socket): SocketSession | undefined {
  return sessions.get(socket.id);
}

export function forgetSocket(socket: Socket): void {
  sessions.delete(socket.id);
}

/**
 * Reads the credential a client presented.
 *
 * Socket.IO clients can send it two ways and both are supported, because the
 * browser cannot set headers on a WebSocket upgrade: `auth.token` is what the
 * client library provides for exactly this, and the `Authorization` header
 * works for a server-side client or a polling transport.
 */
function credentialOf(socket: Socket): string | null {
  const auth = socket.handshake.auth as { token?: unknown } | undefined;
  if (typeof auth?.token === 'string' && auth.token !== '') return auth.token;

  const header = socket.handshake.headers.authorization;
  if (typeof header === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (match?.[1] !== undefined) return match[1];
  }

  return null;
}

/**
 * Authenticates a connecting socket, or refuses it.
 *
 * The error message is deliberately vague — "unauthorised", not "expired" or
 * "wrong audience". An HTTP caller gets a reason because it has to decide
 * between refreshing and re-logging in; a socket just reconnects, and the
 * distinction only helps somebody probing for a valid token shape.
 */
export async function authenticateSocket(
  socket: Socket,
  next: (error?: Error) => void,
): Promise<void> {
  const token = credentialOf(socket);
  if (token === null) {
    next(new Error('unauthorised'));
    return;
  }

  // A guest tracking link is a `guest` access token minted at booking
  // (`FR-GST-05`), so it verifies through the same path. It carries a
  // `bookingId` claim, which is what scopes it to one booking.
  const result = await verifyToken(token, 'access');
  if (!result.ok) {
    next(new Error('unauthorised'));
    return;
  }

  const principal = toPrincipal(result.claims);
  if (principal === null) {
    next(new Error('unauthorised'));
    return;
  }

  const staffId = result.claims.kind === 'staff' ? result.claims.sub : null;
  const familyId = typeof result.claims.sid === 'string' ? result.claims.sid : null;

  // A token that is still inside its fifteen minutes and whose access has
  // been ended does not connect (`FR-SEC-06`).
  if (staffId !== null && !(await staffAccessLive(staffId, familyId))) {
    next(new Error('unauthorised'));
    return;
  }

  sessions.set(socket.id, {
    principal,
    rooms: new Set(),
    staffId,
    familyId,
    close: () => {
      socket.disconnect(true);
    },
  });
  next();
}

/** Closes every connection matching, and says how many there were. */
function drop(match: (session: SocketSession) => boolean): number {
  let closed = 0;
  for (const [id, session] of sessions) {
    if (!match(session)) continue;
    sessions.delete(id);
    session.close();
    closed += 1;
  }
  return closed;
}

/** Every live connection an account has, on every device. */
export function dropStaffSockets(staffId: string): number {
  return drop((session) => session.staffId === staffId);
}

/** The live connections of one sign-in. The person's other devices stay. */
export function dropFamilySockets(familyId: string): number {
  return drop((session) => session.familyId === familyId);
}

/**
 * Closes the connections whose access has ended by a road this process did
 * not see: a command on the server, another instance, a row changed by hand.
 * Run on a timer (`realtime/server.ts`); the bound it gives is its interval.
 */
export async function sweepRevoked(): Promise<number> {
  const staff = [...sessions.values()].filter((session) => session.staffId !== null);

  // One answer per account and sign-in, however many tabs share it.
  const verdicts = new Map<string, boolean>();
  for (const session of staff) {
    const key = `${session.staffId ?? ''}|${session.familyId ?? ''}`;
    if (verdicts.has(key)) continue;
    verdicts.set(key, await staffAccessLive(session.staffId ?? '', session.familyId));
  }

  return drop(
    (session) =>
      session.staffId !== null &&
      verdicts.get(`${session.staffId}|${session.familyId ?? ''}`) === false,
  );
}
