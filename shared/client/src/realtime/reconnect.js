/** Socket.IO's reason for a close the server asked for. */
const DROPPED_BY_SERVER = 'io server disconnect';

/** A moment, so that a console given new tokens by the same request has them. */
const RETRY_AFTER_MS = 1_000;

export function reconnectIfDropped(
  socket,
  reason,
  /** True once the channel's owner has closed it: then nothing reopens it. */
  isClosed,
) {
  if (reason !== DROPPED_BY_SERVER) return;

  setTimeout(() => {
    if (isClosed() || socket.connected) return;
    socket.connect();
  }, RETRY_AFTER_MS);
}
