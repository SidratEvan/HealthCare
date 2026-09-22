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

import { io, type Socket } from 'socket.io-client';

import type { EmergencyCaseView, PublicCapacity, ReferralView } from '@platform/domain';

export interface CapabilityState {
  readonly kind: string;
  readonly available: boolean;
  readonly updatedAt: string;
}

export interface EmergencyChannelOptions {
  readonly url: string;
  readonly getToken: () => string | null;
  readonly onConnection: (connected: boolean) => void;
  readonly onInbound: (current: EmergencyCaseView, serverTs: string) => void;
  readonly onCase: (current: EmergencyCaseView, load: number, serverTs: string) => void;
  readonly onCapabilities: (capabilities: readonly CapabilityState[], serverTs: string) => void;
  readonly onCapacity: (published: PublicCapacity, serverTs: string) => void;
  /** `incoming` is true for a referral this ER has just been sent. */
  readonly onReferral: (referral: ReferralView, incoming: boolean, serverTs: string) => void;
}

export function openEmergencyChannel(options: EmergencyChannelOptions): {
  readonly close: () => void;
  readonly socket: Socket;
} {
  const socket = io(options.url, {
    auth: (cb: (data: Record<string, unknown>) => void) => {
      cb({ token: options.getToken() });
    },
    transports: ['websocket', 'polling'],
    // Its own connection, for the reason `openSessionChannel` gives.
    forceNew: true,
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
  });

  socket.on('connect', () => {
    options.onConnection(true);
  });
  socket.on('disconnect', () => {
    // The console stays on screen with what it knew, and says it is offline.
    // An ER screen that blanks when the wifi drops is useless exactly when a
    // bus crash fills the corridor (`FR-OFF-01`).
    options.onConnection(false);
  });

  socket.on(
    'emergency.inbound',
    (message: { serverTs: string; data: { case: EmergencyCaseView } }) => {
      options.onInbound(message.data.case, message.serverTs);
    },
  );
  socket.on(
    'emergency.updated',
    (message: { serverTs: string; data: { case: EmergencyCaseView; load: number } }) => {
      options.onCase(message.data.case, message.data.load, message.serverTs);
    },
  );
  socket.on(
    'capabilities.updated',
    (message: { serverTs: string; data: { capabilities: CapabilityState[] } }) => {
      options.onCapabilities(message.data.capabilities, message.serverTs);
    },
  );
  socket.on('capacity.updated', (message: { serverTs: string; data: PublicCapacity }) => {
    options.onCapacity(message.data, message.serverTs);
  });
  socket.on(
    'referral.incoming',
    (message: { serverTs: string; data: { referral: ReferralView } }) => {
      options.onReferral(message.data.referral, true, message.serverTs);
    },
  );
  socket.on(
    'referral.updated',
    (message: { serverTs: string; data: { referral: ReferralView } }) => {
      options.onReferral(message.data.referral, false, message.serverTs);
    },
  );

  return {
    close: () => {
      socket.disconnect();
    },
    socket,
  };
}
