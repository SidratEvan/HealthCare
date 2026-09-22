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
  loadOf,
  type BedKind,
  type EmergencyCaseView,
  type EmergencyProblem,
  type LocalEmergencyChange,
  type PublicCapacity,
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
    });

    return () => {
      channel.close();
    };
  }, [getToken, hospitalId, flush, upsert, alarm]);

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
            }
          : {
              method: 'PATCH',
              path: `/emergency/cases/${caseId}`,
              body: { action, ...rest },
              caseId,
              change,
              provisional: null,
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
      });
    },
    [enqueue, hospitalId],
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
    api,
  };
}
