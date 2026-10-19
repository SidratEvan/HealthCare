/**
 * The ward board's channel: `hospital:<id>:beds` (BACKEND.md §6).
 *
 * A staff socket is put into its own hospital's board rooms on connect
 * (`ambientRoomsFor` in the API), so there is nothing to subscribe to — this
 * opens the connection and routes three events to the board:
 *
 *   `bed.updated`         the beds an action changed, as they now stand
 *   `capacity.updated`    what the public view now publishes (`FR-BED-06`)
 *   `bedrequest.updated`  a request arrived or was answered (`FR-BED-07`)
 *   `emergency.handoff`   the ER handed a case to the ward, or it was placed
 *
 * None of them carries a patient's name; the pending list is re-read through
 * the endpoint that audits the read.
 */

import { io } from 'socket.io-client';

import { reconnectIfDropped } from './reconnect.js';

export function openHospitalChannel(options) {
  const socket = io(options.url, {
    auth: (cb) => {
      cb({ token: options.getToken() });
    },
    transports: ['websocket', 'polling'],
    // Its own connection, for the reason `openSessionChannel` gives: a shared
    // Manager closed by one channel is a dead engine for the next.
    forceNew: true,
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
  });

  /** Set by `close`: a channel its owner has closed is never reopened. */
  let closed = false;

  socket.on('connect', () => {
    options.onConnection(true);
  });
  socket.on('disconnect', (reason) => {
    // A close the server asked for is tried once more with the credential now
    // held: a console given a new sign-in comes back, a revoked one is refused
    // (`reconnect.js`, `FR-SEC-06`).
    reconnectIfDropped(socket, reason, () => closed);

    // The board stays on screen, with its freshness line going stale — a
    // board that blanks when the wifi drops is useless exactly when a ward
    // needs it (`FR-OFF-02`).
    options.onConnection(false);
  });

  socket.on('bed.updated', (message) => {
    options.onBeds(message.data.beds, message.serverTs, message.data.clientEventId ?? null);
  });
  socket.on('capacity.updated', (message) => {
    options.onCapacity(message.data, message.serverTs);
  });
  socket.on('bedrequest.updated', (message) => {
    options.onRequest(message.data.requestId, message.data.state);
  });
  socket.on('emergency.handoff', (message) => {
    options.onHandoff?.(message.data.caseId, message.data.state);
  });

  return {
    close: () => {
      closed = true;
      socket.disconnect();
    },
    socket,
  };
}
