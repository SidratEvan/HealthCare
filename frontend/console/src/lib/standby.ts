/**
 * The standby list's calls to the API (`FR-QUE-30`, `FR-REC-30`,
 * `BTN-B02-OFFER`).
 *
 * ## Why these do not go through the queue's outbox
 *
 * Every other reception action is applied optimistically and queued when the
 * network is gone (`FR-QUE-50`), because the console already knows what the
 * action does: *next* moves a row, *late* moves a row. An offer is not like
 * that. Who is asked depends on who is left on the list, who already holds an
 * offer and who let one lapse — the server's knowledge, taken under a row lock
 * (`claimNextStandby`) so two counters never ask the same person. An offer
 * queued offline and replayed an hour later would text somebody about a chair
 * the chamber has long since passed.
 *
 * So both are online-only, and the card says so when the connection is gone
 * rather than failing on a tap. Each send still carries a `clientEventId` and
 * an idempotency key, so a retry after a lost response is a replay, not a
 * second offer.
 */

import { ApiClient } from '@platform/client';

export interface StandbyWaiting {
  readonly id: string;
  readonly position: number;
}

export interface StandbyOffer {
  readonly id: string;
  readonly freedBookingId: string | null;
  readonly offeredAt: string;
  readonly expiresAt: string;
  readonly acceptedAt: string | null;
  readonly recoveredValuePoisha: number | null;
}

export interface StandbyPanel {
  readonly waiting: readonly StandbyWaiting[];
  readonly offers: readonly StandbyOffer[];
  readonly serverTs: string;
}

export interface StandbyApi {
  readonly panel: (sessionId: string) => Promise<StandbyPanel>;
  readonly offer: (freedBookingId: string) => Promise<void>;
  readonly accept: (offerId: string) => Promise<void>;
}

export function standbyApi(apiBaseUrl: string, getToken: () => string | null): StandbyApi {
  const client = new ApiClient({ baseUrl: apiBaseUrl, getToken });

  /** The queue command envelope (`queueCommandEnvelope`), nothing else. */
  const envelope = (): { clientEventId: string; clientTs: string } => ({
    clientEventId: crypto.randomUUID(),
    clientTs: new Date().toISOString(),
  });

  return {
    // Reading the panel is also what records a lapsed offer: nothing sweeps on
    // a timer in this version, so the server expires what has run out as it
    // answers (`getStandby`).
    panel: async (sessionId) => await client.get<StandbyPanel>(`/sessions/${sessionId}/standby`),

    offer: async (freedBookingId) => {
      const body = envelope();
      await client.post(`/bookings/${freedBookingId}/offer-slot`, body, body.clientEventId);
    },

    accept: async (offerId) => {
      const body = envelope();
      await client.post(`/offers/${offerId}/accept`, body, body.clientEventId);
    },
  };
}
