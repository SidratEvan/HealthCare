/**
 * The ER console's calls to the API (BACKEND.md §7.5).
 *
 * Kept out of the hook for the reason `lib/beds.ts` gives: the hook reads as a
 * sequence of decisions, and every write goes through `erSender` — which is
 * also what the offline outbox flushes with, so a tap made online and a tap
 * replayed after an hour offline take one path.
 */

import {
  ApiClient,
  ApiError,
  NetworkError,
  type CapabilityState,
  type ErSendOutcome,
  type PendingErAction,
} from '@platform/client';
import type {
  BedKind,
  EmergencyCaseView,
  EmergencyNeed,
  EmergencyProblem,
  PublicCapacity,
  ReferralView,
} from '@platform/domain';

import { API_BASE } from '@/lib/beds';

/** `GET /hospitals/:id/emergency` — everything `S-B-07` draws. Names nobody. */
export interface ErBoardResponse {
  readonly hospitalId: string;
  readonly hospitalNameBn: string;
  readonly hospitalNameEn: string;
  readonly cases: readonly EmergencyCaseView[];
  readonly load: number;
  readonly capabilities: readonly CapabilityState[];
  readonly published: PublicCapacity | null;
  readonly bedKinds: readonly BedKind[];
  /** Referrals this ER sent or was sent: open ones, and today's closed (`FR-EMG-07..09`). */
  readonly referrals: readonly ReferralView[];
  readonly staleAfterMinutes: number;
  readonly serverTs: string;
}

/**
 * One ER the decline sheet suggests (`FR-EMG-02`), or the refer-out search
 * lists (`FR-EMG-07`) — the same ranked search, from this hospital.
 */
export interface SuggestedHospital {
  readonly hospitalId: string;
  readonly nameBn: string;
  readonly nameEn: string;
  readonly emergencyPhone: string | null;
  readonly distanceKm: number | null;
  readonly travelMinutes: number | null;
  readonly hasCapability: boolean | null;
  readonly freeBeds: number | null;
  readonly erLoad: number;
  readonly freshness: {
    readonly asOf: string | null;
    readonly ageMinutes: number | null;
    readonly stale: boolean;
  };
  readonly staleAfterMinutes: number;
}

export function erApi(getToken: () => string | null): {
  readonly board: (hospitalId: string) => Promise<ErBoardResponse>;
  /** The number, read on purpose — the server audits this (`DB-P7`). */
  readonly contact: (caseId: string) => Promise<string | null>;
  /**
   * Other ERs ranked from this one: for a decline (`FR-EMG-02`), and for a
   * referral, ranked on the need the coordinator names (`FR-EMG-07`).
   */
  readonly suggestions: (
    hospitalId: string,
    problem: EmergencyProblem,
    need?: EmergencyNeed,
  ) => Promise<readonly SuggestedHospital[]>;
} {
  const client = new ApiClient({ baseUrl: API_BASE, getToken });

  return {
    board: async (hospitalId) =>
      await client.get<ErBoardResponse>(`/hospitals/${hospitalId}/emergency`),
    contact: async (caseId) =>
      (await client.get<{ phone: string | null }>(`/emergency/cases/${caseId}/contact`)).phone,
    suggestions: async (hospitalId, problem, need) => {
      const query = new URLSearchParams({ from: hospitalId, problem });
      if (need !== undefined && need.capability !== null) query.set('capability', need.capability);
      if (need !== undefined && need.bedKind !== null) query.set('bedKind', need.bedKind);
      return (
        await client.get<{ results: SuggestedHospital[] }>(`/emergency/search?${query.toString()}`)
      ).results;
    },
  };
}

/**
 * Sends one queued ER action, and says what happened to it.
 *
 * The client event id doubles as the idempotency key. A server error (5xx)
 * counts as unreachable, not refused: nothing was decided about the action,
 * so it stays queued and is tried again.
 */
export function erSender(
  getToken: () => string | null,
): (action: PendingErAction) => Promise<ErSendOutcome> {
  const client = new ApiClient({ baseUrl: API_BASE, getToken });

  return async (action) => {
    const body = { ...action.body, clientEventId: action.clientEventId, clientTs: action.clientTs };
    try {
      if (action.method === 'PATCH') await client.patch(action.path, body, action.clientEventId);
      else if (action.method === 'PUT') await client.put(action.path, body, action.clientEventId);
      else await client.post(action.path, body, action.clientEventId);
      return { kind: 'accepted' };
    } catch (error: unknown) {
      if (error instanceof NetworkError) return { kind: 'unreachable' };
      if (error instanceof ApiError && error.status < 500) {
        const reason =
          typeof error.details?.['guard'] === 'string'
            ? error.details['guard']
            : typeof error.details?.['reason'] === 'string'
              ? error.details['reason']
              : error.code;
        return { kind: 'refused', code: error.code, reason };
      }
      return { kind: 'unreachable' };
    }
  };
}
