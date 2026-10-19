/**
 * The ER console's channel: `hospital:<id>:emergency` (BACKEND.md §6).
 *
 * A staff socket is put into its own hospital's rooms on connect
 * (`ambientRoomsFor` in the API), the beds room included — so this one
 * connection hears both what the ER needs and the bed counters the ER reads
 * from the ward board ("not typed twice", `APP_FLOW.md` B4):
 *
 *   `emergency.inbound`     "I'm on my way" — the console rings (`FR-EMG-01`)
 *   `emergency.updated`     a case moved, with the ER's load (`FR-EMG-04`)
 *   `capabilities.updated`  another screen confirmed the switches (`FR-EMG-05`)
 *   `capacity.updated`      what the public is now shown about beds
 *   `referral.incoming`     another ER asks this one to take somebody — rings
 *   `referral.updated`      a step of a referral this ER sent or was sent
 *                           (`FR-EMG-08`): seen, answered, withdrawn, arrived
 *
 * None carries a phone number: the number is read one case at a time, audited.
 * A referral names nobody either — problem, colour, age, sex, a note.
 */

import { io } from 'socket.io-client';

import { reconnectIfDropped } from './reconnect.js';

export function openEmergencyChannel(options) {
  const socket = io(options.url, {
    auth: (cb) => {
      cb({ token: options.getToken() });
    },
    transports: ['websocket', 'polling'],
    // Its own connection, for the reason `openSessionChannel` gives.
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

    // The console stays on screen with what it knew, and says it is offline.
    // An ER screen that blanks when the wifi drops is useless exactly when a
    // bus crash fills the corridor (`FR-OFF-01`).
    options.onConnection(false);
  });

  socket.on('emergency.inbound', (message) => {
    options.onInbound(message.data.case, message.serverTs);
  });
  socket.on('emergency.updated', (message) => {
    options.onCase(
      message.data.case,
      message.data.load,
      message.serverTs,
      message.data.clientEventId ?? null,
    );
  });
  socket.on('capabilities.updated', (message) => {
    options.onCapabilities(message.data.capabilities, message.serverTs);
  });
  socket.on('capacity.updated', (message) => {
    options.onCapacity(message.data, message.serverTs);
  });
  socket.on('referral.incoming', (message) => {
    options.onReferral(message.data.referral, true, message.serverTs);
  });
  socket.on('referral.updated', (message) => {
    options.onReferral(message.data.referral, false, message.serverTs);
  });

  return {
    close: () => {
      closed = true;
      socket.disconnect();
    },
    socket,
  };
}
