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
 *
 * None of them carries a patient's name; the pending list is re-read through
 * the endpoint that audits the read.
 */

import { io, type Socket } from 'socket.io-client';

import type { BedView, PublicCapacity } from '@platform/domain';

export interface HospitalChannelOptions {
  readonly url: string;
  readonly getToken: () => string | null;
  readonly onConnection: (connected: boolean) => void;
  readonly onBeds: (beds: readonly BedView[], serverTs: string) => void;
  readonly onCapacity: (published: PublicCapacity, serverTs: string) => void;
  readonly onRequest: (requestId: string, state: string) => void;
}

export function openHospitalChannel(options: HospitalChannelOptions): {
  readonly close: () => void;
  readonly socket: Socket;
} {
  const socket = io(options.url, {
    auth: (cb: (data: Record<string, unknown>) => void) => {
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

  socket.on('connect', () => {
    options.onConnection(true);
  });
  socket.on('disconnect', () => {
    // The board stays on screen, with its freshness line going stale — a
    // board that blanks when the wifi drops is useless exactly when a ward
    // needs it (`FR-OFF-02`).
    options.onConnection(false);
  });

  socket.on('bed.updated', (message: { serverTs: string; data: { beds: BedView[] } }) => {
    options.onBeds(message.data.beds, message.serverTs);
  });
  socket.on('capacity.updated', (message: { serverTs: string; data: PublicCapacity }) => {
    options.onCapacity(message.data, message.serverTs);
  });
  socket.on('bedrequest.updated', (message: { data: { requestId: string; state: string } }) => {
    options.onRequest(message.data.requestId, message.data.state);
  });

  return {
    close: () => {
      socket.disconnect();
    },
    socket,
  };
}
