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

import { ErOutbox, openEmergencyChannel, retryDelayMs } from '@platform/client';
import {
  applyLocalCase,
  casesAfterRead,
  newestCases,
  applyLocalReferral,
  loadOf,
  sideOf,
} from '@platform/domain';

import { SOCKET_URL } from '@/lib/beds';
import { erApi, erSender } from '@/lib/emergency';
import { consoleStores } from '@/lib/outbox';

/** How many named actions the console remembers not to draw again. */
const REMEMBERED_SETTLED = 1_000;

/** What an accepted action's answer may carry (`SY-09`), read without trusting its shape. */
function readAnswer(value) {
  const answer = typeof value === 'object' && value !== null ? value : {};
  const current =
    typeof answer.case === 'object' &&
    answer.case !== null &&
    typeof answer.case.version === 'number'
      ? answer.case
      : null;
  return {
    current,
    capabilities: Array.isArray(answer.capabilities) ? answer.capabilities : null,
    serverTs: typeof answer.serverTs === 'string' ? answer.serverTs : null,
  };
}

/** The later of two server times; the freshness line never steps back. */
function later(held, next) {
  return held === null || next > held ? next : held;
}

export function useEmergencyConsole(options) {
  const { hospitalId, alarm } = options;

  const getTokenRef = useRef(options.getToken);
  getTokenRef.current = options.getToken;
  const getToken = useCallback(() => getTokenRef.current(), []);

  const api = useMemo(() => erApi(getToken), [getToken]);
  const send = useMemo(() => erSender(getToken), [getToken]);

  const [board, setBoard] = useState(null);
  const [serverCases, setServerCases] = useState([]);
  const [serverCapabilities, setServerCapabilities] = useState([]);
  const [published, setPublished] = useState(null);
  const [lastServerTs, setLastServerTs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [socketUp, setSocketUp] = useState(false);
  const [browserOnline, setBrowserOnline] = useState(true);
  const [pending, setPending] = useState([]);
  const [stuck, setStuck] = useState([]);
  const [durable, setDurable] = useState(true);
  const [lastRefusal, setLastRefusal] = useState(null);
  const [lastCancelled, setLastCancelled] = useState(null);
  const [newCaseIds, setNewCaseIds] = useState(new Set());
  const [serverReferrals, setServerReferrals] = useState([]);
  const [newReferralIds, setNewReferralIds] = useState(new Set());
  const [lastArrival, setLastArrival] = useState(null);
  const [alarmState, setAlarmState] = useState('blocked');
  const [attempt, setAttempt] = useState(0);

  /** Referrals this page has already queued "seen" for (see `seenReferral`). */
  const seenSaidRef = useRef(new Set());

  const outboxRef = useRef(null);
  // Kept in IndexedDB, in this person's own database (`lib/outbox.js`): a
  // reload or a power cut loses no triage step that was waiting (`FR-OFF-01`).
  outboxRef.current ??= new ErOutbox(consoleStores().emergency);

  useEffect(() => {
    setAlarmState(alarm.state());
  }, [alarm]);

  // --- reading ---------------------------------------------------------------

  /**
   * When this console was first told of each case by the socket, on its own
   * clock. A read of the board that was asked for before then cannot contain
   * the case, and must not take it off the screen (`casesAfterRead`).
   */
  const toldAtRef = useRef(new Map());

  const loadBoard = useCallback(async () => {
    try {
      const askedAt = Date.now();
      const next = await api.board(hospitalId);
      setBoard(next);
      // Every open case, each the newer of the two by version; a case the
      // read was asked too early to contain stays (`SY-09`).
      setServerCases((held) =>
        casesAfterRead(held, next.cases, (id) => (toldAtRef.current.get(id) ?? 0) >= askedAt),
      );
      setServerReferrals(next.referrals);
      setServerCapabilities(next.capabilities);
      setPublished(next.published);
      setLastServerTs((held) => later(held, next.serverTs));
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

  /** Actions a statement from the server has named: done, never drawn again (`SY-09`). */
  const settledRef = useRef(new Set());
  /** This console's unanswered actions, to know a broadcast that names one of them. */
  const waitingRef = useRef([]);
  waitingRef.current = pending.map((action) => action.clientEventId);

  /**
   * A statement has named this action. If it is one this console is waiting
   * on, it comes off the console's own drawing now — in the same turn as the
   * case that contains it is set, so the two are one redraw — and out of the
   * outbox, where there is nothing left to send.
   */
  const settle = useCallback((clientEventId) => {
    if (!waitingRef.current.includes(clientEventId)) return;

    const settled = settledRef.current;
    settled.add(clientEventId);
    for (const key of settled) {
      if (settled.size <= REMEMBERED_SETTLED) break;
      settled.delete(key);
    }
    setPending((held) => held.filter((action) => !settled.has(action.clientEventId)));
    void outboxRef.current?.discard([clientEventId]).catch(() => undefined);
  }, []);

  const refreshPending = useCallback(async () => {
    const outbox = outboxRef.current;
    if (outbox === null) return;

    // Nothing a statement has already named: the outbox may hold it a moment
    // longer than the console may draw it.
    const settled = settledRef.current;
    const here = (action) => action.hospitalId === hospitalId && !settled.has(action.clientEventId);
    setPending((await outbox.pending()).filter(here));
    setStuck((await outbox.stuck()).filter(here));
    setDurable(consoleStores().durable());
  }, [hospitalId]);

  // What was queued before this page loaded is on the screen again at once.
  useEffect(() => {
    void refreshPending();
  }, [refreshPending]);

  const flush = useCallback(async () => {
    const outbox = outboxRef.current;
    if (outbox === null) return;

    const outcome = await outbox.flush(hospitalId, send);
    if (outcome.refused.length > 0) setLastRefusal(outcome.refused[0]?.reason ?? null);

    // What the server answered goes on screen in the redraw that takes the
    // answered actions off it (`SY-09`): the case each step changed, as it
    // stands after the commit — which for a walk-in is the case the server
    // made of the provisional one — and the capabilities a confirmation set.
    let read = 0;
    for (const entry of outcome.answers) {
      const answer = readAnswer(entry.answer);
      const stated = answer.current;
      if (stated !== null) setServerCases((held) => newestCases(held, stated));
      if (answer.capabilities !== null) setServerCapabilities(answer.capabilities);
      if (stated !== null || answer.capabilities !== null) read += 1;
      const at = answer.serverTs;
      if (at !== null) setLastServerTs((held) => later(held, at));
    }
    const answered = new Set([
      ...outcome.accepted,
      ...outcome.refused.map((entry) => entry.clientEventId),
    ]);
    if (answered.size > 0) {
      setPending((held) => held.filter((action) => !answered.has(action.clientEventId)));
    }
    await refreshPending();

    // A refusal means the console drew on a board that was behind, and an
    // accepted action whose answer was not one of the above (a referral's
    // step) is not settled by it: either way, read the board. Not otherwise:
    // the answer was enough.
    if (outcome.refused.length > 0 || outcome.accepted.length > read) {
      await loadBoardRef.current();
    }
  }, [hospitalId, send, refreshPending]);

  const retryStuck = useCallback(async () => {
    await outboxRef.current?.retryStuck();
    await refreshPending();
    await flush();
  }, [refreshPending, flush]);

  const discardStuck = useCallback(async () => {
    await outboxRef.current?.discard(stuck.map((action) => action.clientEventId));
    await refreshPending();
  }, [stuck, refreshPending]);

  // --- the channel -----------------------------------------------------------

  // The newer of the two by version, never whichever arrived last. A case
  // that has closed stays in this list, closed, so that an older statement
  // delivered late cannot bring it back; `cases` draws the open ones.
  const upsert = useCallback((next) => {
    if (!toldAtRef.current.has(next.id)) toldAtRef.current.set(next.id, Date.now());
    setServerCases((held) => newestCases(held, next));
  }, []);

  // Referrals stay once closed: today's are the timeline the console shows.
  const upsertReferral = useCallback((next) => {
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
        setLastServerTs((held) => later(held, serverTs));
        alarm.ring();
      },
      onCase: (current, _load, serverTs, clientEventId) => {
        if (current.hospitalId !== hospitalId) return;
        // The broadcast names the action behind it. If it is this console's,
        // the drawing comes off in the redraw that shows the case.
        if (clientEventId !== null) settle(clientEventId);
        upsert(current);
        if (current.state === 'cancelled') setLastCancelled(current);
        setLastServerTs((held) => later(held, serverTs));
      },
      onCapabilities: (capabilities, serverTs) => {
        setServerCapabilities(capabilities);
        setLastServerTs((held) => later(held, serverTs));
      },
      onCapacity: (next, serverTs) => {
        if (next.hospitalId !== hospitalId) return;
        setPublished(next);
        setLastServerTs((held) => later(held, serverTs));
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
  }, [getToken, hospitalId, flush, upsert, upsertReferral, alarm, settle]);

  useEffect(() => {
    setBrowserOnline(globalThis.navigator?.onLine ?? true);
    const onOnline = () => {
      setBrowserOnline(true);
      void flush();
    };
    const onOffline = () => {
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
    async (action) => {
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

  const command = useCallback(
    async (caseId, next) => {
      const at = new Date().toISOString();
      const change = {
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

  const walkIn = useCallback(
    async (input) => {
      const outbox = outboxRef.current;
      if (outbox === null) return;

      const clientEventId = crypto.randomUUID();
      const at = new Date().toISOString();
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
          // Not the server's yet: any statement about it is newer.
          version: 0,
        },
        referralChange: null,
        provisionalReferral: null,
      });
      await refreshPending();
      await flush();
    },
    [hospitalId, refreshPending, flush],
  );

  const confirmCapabilities = useCallback(
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

  const refer = useCallback(
    async ({ entry, to, need, note }) => {
      const outbox = outboxRef.current;
      if (outbox === null) return;

      const clientEventId = crypto.randomUUID();
      const at = new Date().toISOString();
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
    async (referralId, action, reason) => {
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
          change: { referralId, action, at: new Date().toISOString(), reason },
          side,
        },
        provisionalReferral: null,
      });
    },
    [serverReferrals, hospitalId, enqueue],
  );

  const referralStep = useCallback(
    async (referralId, command) => {
      await step(referralId, command.action, command.action === 'decline' ? command.reason : null);
    },
    [step],
  );

  // --- deriving --------------------------------------------------------------

  const cases = useMemo(() => {
    let current = [...serverCases];
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
      const entries = action.body['capabilities'] ?? [];
      current = current.map((row) => {
        const override = entries.find((entry) => entry.kind === row.kind);
        return override === undefined ? row : { ...row, available: override.available };
      });
    }
    return current;
  }, [serverCapabilities, pending]);

  const referrals = useMemo(() => {
    let current = [...serverReferrals];
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
    const ids = new Set();
    for (const action of pending) {
      if (action.referralChange !== null) ids.add(action.referralChange.change.referralId);
      if (action.provisionalReferral !== null) ids.add(action.provisionalReferral.id);
    }
    return ids;
  }, [pending]);

  const pendingCaseIds = useMemo(() => {
    const ids = new Set();
    for (const action of pending) {
      if (action.caseId !== null) ids.add(action.caseId);
      if (action.provisional !== null) ids.add(action.provisional.id);
    }
    return ids;
  }, [pending]);

  // --- and again, by itself, while something is still waiting ----------------
  //
  // FRONTEND.md §11.1 step 6: "retry with backoff". A push that failed while
  // the socket stayed up — a server restarting, a token being renewed — has no
  // reconnect to prompt the next attempt, and used to wait for somebody's next
  // tap. Offline needs no timer: the reconnect sends at once.
  const retriesRef = useRef(0);
  useEffect(() => {
    if (pending.length === 0) {
      retriesRef.current = 0;
      return undefined;
    }
    if (!(socketUp && browserOnline)) return undefined;

    const timer = setTimeout(() => {
      retriesRef.current += 1;
      void flush();
    }, retryDelayMs(retriesRef.current));
    return () => {
      clearTimeout(timer);
    };
  }, [pending, socketUp, browserOnline, flush]);

  return {
    board,
    cases,
    load: loadOf(cases),
    capabilities,
    published,
    pendingCaseIds,
    pendingCount: pending.length,
    stuckCount: stuck.length,
    retryStuck,
    discardStuck,
    durable,
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
      //
      // One click is two touches — the card hears the pointer and then the
      // focus — and what kept the second from saying "seen" again was the
      // first already being in `pending`. That is state, and it is only as
      // quick as the outbox: kept on disk, the second touch arrived first and
      // "seen" was queued twice. So the page remembers what it has said.
      const current = referrals.find((entry) => entry.id === referralId);
      if (
        current?.state === 'sent' &&
        sideOf(current, hospitalId) === 'receiver' &&
        !pendingReferralIds.has(referralId) &&
        !seenSaidRef.current.has(referralId)
      ) {
        seenSaidRef.current.add(referralId);
        void step(referralId, 'seen', null);
      }
    },
    refer,
    referralStep,
    api,
  };
}
