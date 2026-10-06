/**
 * Coming back after the server has closed a connection (`FR-SEC-06`, plan A6).
 *
 * The server closes a staff connection when the access behind it ends: a
 * sign-out, a deactivation, a password reset. Socket.IO does not reconnect by
 * itself after a close the *server* asked for, on the reasonable ground that
 * the server meant it.
 *
 * It usually did. But the same close reaches a console whose own person has
 * just changed their password, which ends every sign-in they had and gives
 * the console a new one. So the client tries once more, with whatever
 * credential it now holds (the `auth` callback is asked again at each
 * connect):
 *
 * - a console with a fresh sign-in is let in, and carries on;
 * - a console whose access really ended is refused at the handshake, and
 *   that refusal is not retried. It stays off, saying it is not connected,
 *   until somebody signs in.
 *
 * Nothing here is a loop: one attempt per close the server asked for.
 */

import type { Socket } from 'socket.io-client';

/** Socket.IO's reason for a close the server asked for. */
const DROPPED_BY_SERVER = 'io server disconnect';

/** A moment, so that a console given new tokens by the same request has them. */
const RETRY_AFTER_MS = 1_000;

export function reconnectIfDropped(
  socket: Socket,
  reason: string,
  /** True once the channel's owner has closed it: then nothing reopens it. */
  isClosed: () => boolean,
): void {
  if (reason !== DROPPED_BY_SERVER) return;

  setTimeout(() => {
    if (isClosed() || socket.connected) return;
    socket.connect();
  }, RETRY_AFTER_MS);
}
