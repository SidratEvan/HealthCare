/**
 * The ward board's calls to the API (BACKEND.md §7.5).
 *
 * Kept out of the hook so the hook reads as a sequence of decisions, and so a
 * test could hand the hook a fake. Every write goes through `bedSender`,
 * which is also what the offline outbox flushes with — one path for a tap made
 * online and a tap replayed after an hour offline.
 */

import {
  ApiClient,
  ApiError,
  NetworkError,
  type BedSendOutcome,
  type PendingBedAction,
} from '@platform/client';
import type {
  BedKind,
  BedView,
  DhakaDate,
  EmergencyProblem,
  PublicCapacity,
  TriageColor,
  WardView,
} from '@platform/domain';

export const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';
export const SOCKET_URL = process.env['NEXT_PUBLIC_SOCKET_URL'] ?? 'http://localhost:4000';

/** `GET /hospitals/:id/beds`. */
export interface BoardResponse {
  readonly hospitalId: string;
  readonly hospitalNameBn: string;
  readonly hospitalNameEn: string;
  readonly wards: readonly WardView[];
  readonly beds: readonly BedView[];
  readonly published: PublicCapacity | null;
  readonly staleAfterMinutes: number;
  readonly today: DhakaDate;
  readonly serverTs: string;
}

/** `GET /beds/:id` — names the occupant; the read is audited server-side. */
export interface PanelResponse {
  readonly bed: BedView;
  readonly occupant: {
    readonly admissionId: string;
    readonly fullName: string;
    readonly ageYears: number | null;
    readonly sex: string;
    readonly admittedAt: string;
    readonly source: string;
    readonly bedRequestId: string | null;
  } | null;
}

/** One row of `LIST-B06-PENDING`. */
export interface PendingRequest {
  readonly id: string;
  readonly bedKind: BedKind;
  readonly state: 'requested' | 'held';
  readonly bedId: string | null;
  readonly heldBedLabel: string | null;
  readonly holdExpiresAt: string | null;
  readonly patientName: string;
  readonly patientAgeYears: number | null;
  readonly patientSex: string;
  readonly contactPhone: string | null;
  readonly note: string | null;
  readonly createdAt: string;
  readonly expectedArrivalAt: string | null;
}

/**
 * One case the ER handed to the ward (`BTN-B07-ADMIT`) — the ER half of
 * `LIST-B06-PENDING` (`FR-BED-07`). Names nobody; the ward takes the name at
 * the bed.
 */
export interface PendingHandoff {
  readonly caseId: string;
  readonly tokenLabel: string | null;
  readonly problem: EmergencyProblem;
  readonly triage: TriageColor | null;
  readonly ageYears: number | null;
  readonly sex: 'male' | 'female' | 'other' | null;
  readonly bedKind: BedKind;
  readonly requestedAt: string;
}

export function bedApi(getToken: () => string | null): {
  readonly board: (hospitalId: string) => Promise<BoardResponse>;
  readonly panel: (bedId: string) => Promise<PanelResponse>;
  readonly pending: (hospitalId: string) => Promise<{
    readonly requests: readonly PendingRequest[];
    readonly handoffs: readonly PendingHandoff[];
  }>;
  readonly respond: (requestId: string, body: Record<string, unknown>) => Promise<void>;
} {
  const client = new ApiClient({ baseUrl: API_BASE, getToken });

  return {
    board: async (hospitalId) => await client.get<BoardResponse>(`/hospitals/${hospitalId}/beds`),
    panel: async (bedId) => await client.get<PanelResponse>(`/beds/${bedId}`),
    pending: async (hospitalId) =>
      await client.get<{ requests: PendingRequest[]; handoffs: PendingHandoff[] }>(
        `/hospitals/${hospitalId}/bed-requests`,
      ),
    respond: async (requestId, body) => {
      const clientEventId = crypto.randomUUID();
      await client.post(
        `/bed-requests/${requestId}/respond`,
        { ...body, clientEventId, clientTs: new Date().toISOString() },
        clientEventId,
      );
    },
  };
}

/**
 * Sends one queued ward action, and says what happened to it.
 *
 * The client event id doubles as the idempotency key: a replay after a
 * dropped connection carries both, and the server recognises it by the first
 * (`bed_events.client_event_id`, `SY-02`).
 *
 * A server error (5xx) counts as *unreachable*, not refused: nothing was
 * decided about the action, so it stays queued and is tried again.
 */
export function bedSender(
  getToken: () => string | null,
): (action: PendingBedAction) => Promise<BedSendOutcome> {
  const client = new ApiClient({ baseUrl: API_BASE, getToken });

  return async (action) => {
    try {
      await client.post(
        action.path,
        { ...action.body, clientEventId: action.clientEventId, clientTs: action.clientTs },
        action.clientEventId,
      );
      return { kind: 'accepted' };
    } catch (error: unknown) {
      if (error instanceof NetworkError) return { kind: 'unreachable' };
      if (error instanceof ApiError && error.status < 500) {
        const reason =
          typeof error.details?.['reason'] === 'string' ? error.details['reason'] : error.code;
        return { kind: 'refused', code: error.code, reason };
      }
      return { kind: 'unreachable' };
    }
  };
}
