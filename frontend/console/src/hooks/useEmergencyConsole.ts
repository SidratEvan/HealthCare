'use client';

/**
 * The ER console's one stateful hook (`S-B-07`, FRONTEND.md §11.1).
 *
 * The optimistic shape `useBedBoard` has, for cases:
 *
 *   1. put the action in the outbox with a client timestamp and event id
 *   2. apply it to the list at once with `applyLocalCase` from `shared/domain`
 *      — the guard the server runs, not a copy of it
 *   3. send it when there is a network; the server's `emergency.updated`
 *      then replaces the optimistic case
 *   4. on refusal drop it, which rolls the case back, and say so (`SY-03`)
 *   5. on no network leave it applied and counted as pending (`FR-OFF-01`)
 *
 * A walk-in registered offline is drawn from its outbox entry until the
 * server has given it a token; the console never invents a token somebody
 * might call aloud.
 *
 * ## What rings
 *
 * `emergency.inbound` rings the alarm and marks the card new until somebody
 * looks at it (`FR-EMG-01`). A case read from the board on load does not ring:
 * the alarm is for arrival, and a console opened on three waiting alerts
 * shows them — loudly, as new — without sounding three times at once.
 *
 * `referral.incoming` rings the same way (`FR-EMG-09`): another ER has a
 * person waiting on this one's answer. The first touch of the card is what
 * tells the sender it was seen (`FR-EMG-08`) — a person looked, not a screen
 * that happened to be open.
 *
 * ## Referrals ride the same outbox
 *
 * Sending, answering, withdrawing and recording an arrival are queued and
 * applied at once with `applyLocalReferral`, as case actions are with
 * `applyLocalCase`, and in the same order: a referral of a walk-in registered
 * offline never reaches the server before the walk-in does.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ErOutbox,
  createMemoryErStore,
  openEmergencyChannel,
  type CapabilityState,
  type PendingErAction,
} from '@platform/client';
import {
  applyLocalCase,
  applyLocalReferral,
  loadOf,
  sideOf,
  type BedKind,
  type EmergencyCaseView,
  type EmergencyNeed,
  type EmergencyProblem,
  type LocalEmergencyChange,
  type PublicCapacity,
  type ReferralParty,
  type ReferralView,
  type Sex,
  type Timestamp,
  type TriageColor,
} from '@platform/domain';

import { SOCKET_URL } from '@/lib/beds';
import { erApi, erSender, type ErBoardResponse } from '@/lib/emergency';

import type { Alarm, AlarmState } from '@/lib/alarm';

export interface WalkInInput {
  readonly problem: EmergencyProblem;
  readonly triage: TriageColor | null;
  readonly phone: string | null;
  readonly ageYears: number | null;
  readonly sex: Sex | null;
}

export type CaseCommand =
  | { readonly action: 'acknowledge' }
  | { readonly action: 'accept' }
  | { readonly action: 'decline'; readonly reason: string }
  | { readonly action: 'triage'; readonly triage: TriageColor }
  | { readonly action: 'handoff'; readonly bedKind: BedKind }
  | { readonly action: 'discharge' };

/** `BTN-B07-REFER-SEND-<hospitalId>`: who, to where, asking for what. */
export interface ReferInput {
  readonly entry: EmergencyCaseView;
  readonly to: ReferralParty;
  readonly need: EmergencyNeed;
  readonly note: string | null;
}

/** A step on a referral that already exists. `seen` is sent by `seenReferral`. */
export type ReferralCommand =
  | { readonly action: 'accept' }
  | { readonly action: 'decline'; readonly reason: string }
  | { readonly action: 'cancel' }
  | { readonly action: 'arrive' };

export interface EmergencyConsole {
  readonly board: ErBoardResponse | null;
  /** The server's cases with the outbox applied, open ones only. */
  readonly cases: readonly EmergencyCaseView[];
  /** `FR-EMG-04`, counted from `cases`. */
  readonly load: number;
  readonly capabilities: readonly CapabilityState[];
  readonly published: PublicCapacity | null;
  /** Cases with a change still waiting to reach the server. */
  readonly pendingCaseIds: ReadonlySet<string>;
  readonly pendingCount: number;
  /** Alerts that rang and nobody has opened yet. */
  readonly newCaseIds: ReadonlySet<string>;
  readonly connected: boolean;
  readonly lastServerTs: string | null;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly retry: () => void;
  readonly lastRefusal: string | null;
  readonly clearRefusal: () => void;
  /** The last case the family called off, for a one-time notice. */
  readonly lastCancelled: EmergencyCaseView | null;
  readonly clearCancelled: () => void;
  readonly alarm: AlarmState;
  readonly unlockAlarm: () => Promise<void>;
  readonly seen: (caseId: string) => void;
  readonly command: (caseId: string, command: CaseCommand) => Promise<void>;
  readonly walkIn: (input: WalkInInput) => Promise<void>;
  readonly confirmCapabilities: (
    entries: readonly { readonly kind: string; readonly available: boolean }[],
  ) => Promise<void>;
  /** Referrals this ER sent or was sent, with the outbox applied (`FR-EMG-07..09`). */
  readonly referrals: readonly ReferralView[];
  /** Referrals with a step still waiting to reach the server. */
  readonly pendingReferralIds: ReadonlySet<string>;
  /** Incoming referrals that rang and nobody has touched yet. */
  readonly newReferralIds: ReadonlySet<string>;
  /** The last referral whose person arrived here, for a one-time notice of their token. */
  readonly lastArrival: ReferralView | null;
  readonly clearArrival: () => void;
  /** The first touch of an incoming referral: clears "new" and tells the sender. */
  readonly seenReferral: (referralId: string) => void;
  readonly refer: (input: ReferInput) => Promise<void>;
  readonly referralStep: (referralId: string, command: ReferralCommand) => Promise<void>;
  readonly api: ReturnType<typeof erApi>;
}

export function useEmergencyConsole(options: {
  readonly hospitalId: string;
  readonly getToken: () => string | null;
  readonly alarm: Alarm;
}): EmergencyConsole {
  const { hospitalId, alarm } = options;

  const getTokenRef = useRef(options.getToken);
  getTokenRef.current = options.getToken;
  const getToken = useCallback(() => getTokenRef.current(), []);

  const api = useMemo(() => erApi(getToken), [getToken]);
  const send = useMemo(() => erSender(getToken), [getToken]);

  const [board, setBoard] = useState<ErBoardResponse | null>(null);
  const [serverCases, setServerCases] = useState<readonly EmergencyCaseView[]>([]);
  const [serverCapabilities, setServerCapabilities] = useState<readonly CapabilityState[]>([]);
  const [published, setPublished] = useState<PublicCapacity | null>(null);
  const [lastServerTs, setLastServerTs] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [socketUp, setSocketUp] = useState(false);
  const [browserOnline, setBrowserOnline] = useState(true);
  const [pending, setPending] = useState<PendingErAction[]>([]);
  const [lastRefusal, setLastRefusal] = useState<string | null>(null);
  const [lastCancelled, setLastCancelled] = useState<EmergencyCaseView | null>(null);
  const [newCaseIds, setNewCaseIds] = useState<ReadonlySet<string>>(new Set());
  const [serverReferrals, setServerReferrals] = useState<readonly ReferralView[]>([]);
  const [newReferralIds, setNewReferralIds] = useState<ReadonlySet<string>>(new Set());
  const [lastArrival, setLastArrival] = useState<ReferralView | null>(null);
  const [alarmState, setAlarmState] = useState<AlarmState>('blocked');
  const [attempt, setAttempt] = useState(0);

  const outboxRef = useRef<ErOutbox | null>(null);
  outboxRef.current ??= new ErOutbox(createMemoryErStore());

  useEffect(() => {
    setAlarmState(alarm.state());
  }, [alarm]);

  // --- reading ---------------------------------------------------------------

  const loadBoard = useCallback(async () => {
    try {
      const next = await api.board(hospitalId);
      setBoard(next);
      setServerCases(next.cases);
      setServerReferrals(next.referrals);
      setServerCapabilities(next.capabilities);
      setPublished(next.published);
      setLastServerTs(next.serverTs);
      setFailed(false);
    } catch {
      // A console already on screen stays there, ageing honestly; only one
      // that never loaded is an error (`GR-03`).
      setFailed((previous) => previous || board === null);
    } finally {
      setLoading(false);
    }
  }, [api, hospitalId, board]);

  const loadBoardRef = useRef(loadBoard);
  loadBoardRef.current = loadBoard;
  useEffect(() => {
    void loadBoardRef.current();
  }, [hospitalId, attempt]);

  // --- sending ---------------------------------------------------------------

  const refreshPending = useCallback(async () => {
    const outbox = outboxRef.current;
    if (outbox !== null) setPending(await outbox.pending());
  }, []);

  const flush = useCallback(async () => {
    const outbox = outboxRef.current;
    if (outbox === null) return;

    const outcome = await outbox.flush(hospitalId, send);
    if (outcome.refused.length > 0) setLastRefusal(outcome.refused[0]?.reason ?? null);
    await refreshPending();

    // The socket normally carries the server's version of each change; a
    // re-read covers the socket being the thing that was down, and replaces a
    // provisional walk-in with the case the server made of it.
    if (outcome.accepted.length > 0 || outcome.refused.length > 0) await loadBoardRef.current();
  }, [hospitalId, send, refreshPending]);

  // --- the channel -----------------------------------------------------------

  const upsert = useCallback((next: EmergencyCaseView) => {
    setServerCases((current) => {
      const without = current.filter((entry) => entry.id !== next.id);
      // The list is the open cases; one that has closed leaves it.
      return next.closedAt === null ? [...without, next] : without;
    });
  }, []);

  // Referrals stay once closed: today's are the timeline the console shows.
  const upsertReferral = useCallback((next: ReferralView) => {
    setServerReferrals((current) => [next, ...current.filter((entry) => entry.id !== next.id)]);
  }, []);

  useEffect(() => {
    const channel = openEmergencyChannel({
      url: SOCKET_URL,
      getToken,
      onConnection: (connected) => {
        setSocketUp(connected);
        if (connected) {
          void loadBoardRef.current();
          void flush();
        }
      },
      onInbound: (current, serverTs) => {
        if (current.hospitalId !== hospitalId) return;
        upsert(current);
        setNewCaseIds((previous) => new Set([...previous, current.id]));
        setLastServerTs(serverTs);
        alarm.ring();
      },
      onCase: (current, _load, serverTs) => {
        if (current.hospitalId !== hospitalId) return;
        upsert(current);
        if (current.state === 'cancelled') setLastCancelled(current);
        setLastServerTs(serverTs);
      },
      onCapabilities: (capabilities, serverTs) => {
        setServerCapabilities(capabilities);
        setLastServerTs(serverTs);
      },
      onCapacity: (next, serverTs) => {
        if (next.hospitalId !== hospitalId) return;
        setPublished(next);
        setLastServerTs(serverTs);
      },
      onReferral: (next, incoming, serverTs) => {
        const side = sideOf(next, hospitalId);
        if (side === null) return;
        upsertReferral(next);
        setLastServerTs(serverTs);
        if (incoming && side === 'receiver') {
          setNewReferralIds((previous) => new Set([...previous, next.id]));
          alarm.ring();
        }
        if (side === 'receiver' && next.state === 'arrived' && next.arrivedTokenLabel !== null) {
          setLastArrival(next);
        }
      },
    });

    return () => {
      channel.close();
    };
  }, [getToken, hospitalId, flush, upsert, upsertReferral, alarm]);

  useEffect(() => {
    setBrowserOnline(globalThis.navigator?.onLine ?? true);
    const onOnline = (): void => {
      setBrowserOnline(true);
      void flush();
    };
    const onOffline = (): void => {
      setBrowserOnline(false);
    };
    globalThis.addEventListener?.('online', onOnline);
    globalThis.addEventListener?.('offline', onOffline);
    return () => {
      globalThis.removeEventListener?.('online', onOnline);
      globalThis.removeEventListener?.('offline', onOffline);
    };
  }, [flush]);

  // --- acting ----------------------------------------------------------------

  const enqueue = useCallback(
    async (
      action: Omit<PendingErAction, 'attempts' | 'clientEventId' | 'clientTs' | 'hospitalId'>,
    ) => {
      const outbox = outboxRef.current;
      if (outbox === null) return;
      await outbox.enqueue({
        ...action,
        clientEventId: crypto.randomUUID(),
        clientTs: new Date().toISOString(),
        hospitalId,
      });
      // On the screen before anything touches the network (`NFR-02`).
      await refreshPending();
      await flush();
    },
    [hospitalId, refreshPending, flush],
  );

  const command = useCallback<EmergencyConsole['command']>(
    async (caseId, next) => {
      const at = new Date().toISOString() as Timestamp;
      const change: LocalEmergencyChange = {
        caseId,
        action: next.action,
        at,
        ...(next.action === 'decline' ? { reason: next.reason } : {}),
        ...(next.action === 'triage' ? { triage: next.triage } : {}),
        ...(next.action === 'handoff' ? { bedKind: next.bedKind } : {}),
      };

      const { action, ...rest } = next;
      await enqueue(
        action === 'acknowledge'
          ? {
              method: 'POST',
              path: `/emergency/cases/${caseId}/acknowledge`,
              body: {},
              caseId,
              change,
              provisional: null,
              referralChange: null,
              provisionalReferral: null,
            }
          : {
              method: 'PATCH',
              path: `/emergency/cases/${caseId}`,
              body: { action, ...rest },
              caseId,
              change,
              provisional: null,
              referralChange: null,
              provisionalReferral: null,
            },
      );
    },
    [enqueue],
  );

  const walkIn = useCallback<EmergencyConsole['walkIn']>(
    async (input) => {
      const outbox = outboxRef.current;
      if (outbox === null) return;

      const clientEventId = crypto.randomUUID();
      const at = new Date().toISOString() as Timestamp;
      await outbox.enqueue({
        clientEventId,
        clientTs: at,
        hospitalId,
        method: 'POST',
        path: '/emergency/cases',
        body: { ...input },
        caseId: null,
        change: null,
        // Drawn until the server answers. No token: nobody calls "ER-?" aloud.
        provisional: {
          id: clientEventId,
          hospitalId,
          state: 'arrived',
          problem: input.problem,
          triage: input.triage,
          tokenLabel: null,
          ageYears: input.ageYears,
          sex: input.sex,
          hasPhone: input.phone !== null,
          inboundAt: null,
          inboundEtaMinutes: null,
          acknowledgedAt: null,
          arrivedAt: at,
          closedAt: null,
          declineReason: null,
          admitBedKind: null,
          admitRequestedAt: null,
        },
        referralChange: null,
        provisionalReferral: null,
      });
      await refreshPending();
      await flush();
    },
    [hospitalId, refreshPending, flush],
  );

  const confirmCapabilities = useCallback<EmergencyConsole['confirmCapabilities']>(
    async (entries) => {
      await enqueue({
        method: 'PUT',
        path: `/hospitals/${hospitalId}/capabilities`,
        body: { capabilities: entries },
        caseId: null,
        change: null,
        provisional: null,
        referralChange: null,
        provisionalReferral: null,
      });
    },
    [enqueue, hospitalId],
  );

  // --- referrals (FR-EMG-07..09) ---------------------------------------------

  const refer = useCallback<EmergencyConsole['refer']>(
    async ({ entry, to, need, note }) => {
      const outbox = outboxRef.current;
      if (outbox === null) return;

      const clientEventId = crypto.randomUUID();
      const at = new Date().toISOString() as Timestamp;
      await outbox.enqueue({
        clientEventId,
        clientTs: at,
        hospitalId,
        method: 'POST',
        path: '/referrals',
        body: {
          emergencyCaseId: entry.id,
          toHospitalId: to.hospitalId,
          requiredCapability: need.capability,
          requiredBedKind: need.bedKind,
          note,
        },
        caseId: entry.id,
        change: null,
        provisional: null,
        referralChange: null,
        // Drawn on the case's row until the server has it; its id is the
        // clientEventId, which is also the referral's idempotency key.
        provisionalReferral: {
          id: clientEventId,
          from: {
            hospitalId,
            nameBn: board?.hospitalNameBn ?? '',
            nameEn: board?.hospitalNameEn ?? '',
            phone: null,
          },
          to,
          emergencyCaseId: entry.id,
          fromTokenLabel: entry.tokenLabel,
          arrivedCaseId: null,
          arrivedTokenLabel: null,
          requiredCapability: need.capability,
          requiredBedKind: need.bedKind,
          summary: {
            problem: entry.problem,
            triage: entry.triage,
            ageYears: entry.ageYears,
            sex: entry.sex,
            note,
          },
          state: 'sent',
          sentAt: at,
          seenAt: null,
          respondedAt: null,
          arrivedAt: null,
          closedAt: null,
          declineReason: null,
        },
      });
      await refreshPending();
      await flush();
    },
    [hospitalId, board, refreshPending, flush],
  );

  const step = useCallback(
    async (
      referralId: string,
      action: 'seen' | ReferralCommand['action'],
      reason: string | null,
    ) => {
      const current = serverReferrals.find((entry) => entry.id === referralId);
      const side = current === undefined ? null : sideOf(current, hospitalId);
      if (side === null) return;
      await enqueue({
        method: 'POST',
        path: `/referrals/${referralId}/${action}`,
        body: reason === null ? {} : { reason },
        caseId: null,
        change: null,
        provisional: null,
        referralChange: {
          change: { referralId, action, at: new Date().toISOString() as Timestamp, reason },
          side,
        },
        provisionalReferral: null,
      });
    },
    [serverReferrals, hospitalId, enqueue],
  );

  const referralStep = useCallback<EmergencyConsole['referralStep']>(
    async (referralId, command) => {
      await step(referralId, command.action, command.action === 'decline' ? command.reason : null);
    },
    [step],
  );

  // --- deriving --------------------------------------------------------------

  const cases = useMemo(() => {
    let current: EmergencyCaseView[] = [...serverCases];
    for (const action of pending) {
      if (action.provisional !== null) {
        current = [...current, action.provisional];
      } else if (action.change !== null) {
        const change = action.change;
        current = current.map((entry) =>
          entry.id === change.caseId ? applyLocalCase(entry, change) : entry,
        );
      }
    }
    return current.filter((entry) => entry.closedAt === null);
  }, [serverCases, pending]);

  const capabilities = useMemo(() => {
    let current = serverCapabilities;
    for (const action of pending) {
      if (action.method !== 'PUT') continue;
      const entries = (action.body['capabilities'] ?? []) as { kind: string; available: boolean }[];
      current = current.map((row) => {
        const override = entries.find((entry) => entry.kind === row.kind);
        return override === undefined ? row : { ...row, available: override.available };
      });
    }
    return current;
  }, [serverCapabilities, pending]);

  const referrals = useMemo(() => {
    let current: ReferralView[] = [...serverReferrals];
    for (const action of pending) {
      if (action.provisionalReferral !== null) {
        current = [action.provisionalReferral, ...current];
      } else if (action.referralChange !== null) {
        const { change, side } = action.referralChange;
        current = current.map((entry) =>
          entry.id === change.referralId ? applyLocalReferral(entry, change, side) : entry,
        );
      }
    }
    return current;
  }, [serverReferrals, pending]);

  const pendingReferralIds = useMemo(() => {
    const ids = new Set<string>();
    for (const action of pending) {
      if (action.referralChange !== null) ids.add(action.referralChange.change.referralId);
      if (action.provisionalReferral !== null) ids.add(action.provisionalReferral.id);
    }
    return ids;
  }, [pending]);

  const pendingCaseIds = useMemo(() => {
    const ids = new Set<string>();
    for (const action of pending) {
      if (action.caseId !== null) ids.add(action.caseId);
      if (action.provisional !== null) ids.add(action.provisional.id);
    }
    return ids;
  }, [pending]);

  return {
    board,
    cases,
    load: loadOf(cases),
    capabilities,
    published,
    pendingCaseIds,
    pendingCount: pending.length,
    newCaseIds,
    connected: socketUp && browserOnline,
    lastServerTs,
    loading,
    failed,
    retry: () => {
      setLoading(true);
      setFailed(false);
      setAttempt((value) => value + 1);
    },
    lastRefusal,
    clearRefusal: () => {
      setLastRefusal(null);
    },
    lastCancelled,
    clearCancelled: () => {
      setLastCancelled(null);
    },
    alarm: alarmState,
    unlockAlarm: async () => {
      setAlarmState(await alarm.unlock());
    },
    seen: (caseId) => {
      setNewCaseIds((previous) => {
        if (!previous.has(caseId)) return previous;
        const next = new Set(previous);
        next.delete(caseId);
        return next;
      });
    },
    command,
    walkIn,
    confirmCapabilities,
    referrals,
    pendingReferralIds,
    newReferralIds,
    lastArrival,
    clearArrival: () => {
      setLastArrival(null);
    },
    seenReferral: (referralId) => {
      setNewReferralIds((previous) => {
        if (!previous.has(referralId)) return previous;
        const next = new Set(previous);
        next.delete(referralId);
        return next;
      });
      // "Seen" is said once, by the first touch, and only of one still unseen.
      const current = referrals.find((entry) => entry.id === referralId);
      if (
        current?.state === 'sent' &&
        sideOf(current, hospitalId) === 'receiver' &&
        !pendingReferralIds.has(referralId)
      ) {
        void step(referralId, 'seen', null);
      }
    },
    refer,
    referralStep,
    api,
  };
}
