'use client';

/**
 * The doctor console — `S-B-05` (`APP_FLOW.md` B2).
 *
 * Two columns, and the split is the point. The left is *this consultation*: who
 * is in front of the doctor, what they said before coming in, what they have
 * been seen for before. The right is *the record*: what the doctor concludes,
 * and the one button that both files it and calls the next patient.
 *
 * ## It runs on the same queue as reception
 *
 * `useSessionQueue` is shared with `S-B-02` — same socket, same reducer, same
 * offline log. That is not code reuse for its own sake: `FR-QUE-53` requires the
 * doctor's *next* and reception's *next* to be serialised against each other,
 * and the only way two screens can be trusted to agree is for them to be
 * reading the same state from the same place.
 *
 * ## Prescribing (plan R2)
 *
 * `TBL-B05-RX` and `BTN-B05-ADDRX` (`FR-DOC-04`, `FR-DOC-05`) are the
 * medicine rows, saved and signed with the visit. Signing moves the chamber
 * to the next patient, so the visit just signed stays offered for printing
 * (`BTN-B05-PRINT`, `FR-DOC-07`) until the next one is signed; it prints the
 * record read back from the server, never the screen's copy of it.
 *
 * `BTN-B05-SCAN` is here as a pasted code rather than a camera — see
 * `ConsentScan`.
 *
 * `BTN-B05-TEST` arrived with step 17. The chips come from the hospital's own
 * catalogue (`GET /lab/catalogue`), and `APP_FLOW.md` B2 says when they are
 * sent: "pushed to lab queue **on save**". So ticking a chip writes nothing —
 * the orders go with the record, in the order that matters, because
 * `POST /test-orders` reads the patient and the hospital from the visit and
 * there is no visit until the record is filed.
 *
 * ## The failure that is spelled out in the document
 *
 * B2: "if the prescription fails to save, the consultation is **not** marked
 * done, and the doctor sees a retry banner with the draft preserved locally."
 * So the record is saved first and the queue advances only on success, and a
 * failure leaves every field exactly as typed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  nowServing,
  outstandingDelayMinutes,
  queueCounts,
  readMedicineRows,
  SYMPTOM_SIGNALS,
  time,
  waitingQueue,
} from '@platform/domain';
import type { MedicineRow, MedicineRowProblems, QueueEntry } from '@platform/domain';
import {
  format,
  formatClock,
  formatNumber,
  formatTaka,
  symptomSignalName,
  t,
  formatAge,
  numeralsFor,
  localName,
  prescriptionSheet,
} from '@platform/i18n';
import {
  Button,
  Card,
  Chip,
  FilterChip,
  FreshnessLine,
  Input,
  ToastProvider,
  useToast,
  useLocale,
  usePrintSheet,
} from '@platform/ui';

import { ConsentScan } from '@/components/ConsentScan';
import { ConsoleLanguageSwitch } from '@/components/ConsoleLanguageSwitch';
import { MedicineRows } from '@/components/MedicineRows';
import { OfflineBlock } from '@/components/OfflineBlock';
import { PatientPanel } from '@/components/PatientPanel';
import { WorkspaceBrandMark } from '@/components/WorkspaceBrandMark';
import { useSessionQueue } from '@/hooks/useSessionQueue';
import { readDemoSession } from '@/lib/demo';
import {
  fetchRecords,
  fetchConsultation,
  consultationDraft,
  RequestFailed,
  fetchSessionFee,
  fetchTestCatalogue,
  orderTests,
  saveVisit,
  type CatalogueTest,
  type VisitDraft,
} from '@/lib/visits';

import type { ReactNode } from 'react';

/** `SEL-B05-FOLLOWUP`: "7/14/30 days or date". */
const FOLLOW_UP_CHOICES = [7, 14, 30] as const;

function readToken(): string | null {
  return readDemoSession()?.token ?? null;
}

export function DoctorConsole(): ReactNode {
  return (
    <ToastProvider placement="console">
      <DoctorBody />
    </ToastProvider>
  );
}

function DoctorBody(): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const { show } = useToast();
  const sessionId = useSessionId();
  const [now, setNow] = useState(() => new Date());

  // The freshness caption has to age on screen without anything else happening
  // (`FR-OFF-03`).
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const queue = useSessionQueue({
    sessionId: sessionId ?? '',
    apiBaseUrl: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1',
    socketUrl: process.env['NEXT_PUBLIC_SOCKET_URL'] ?? 'http://localhost:4000',
    getToken: readToken,
  });

  useEffect(() => {
    if (queue.lastConflict === null) return;
    show({ title: t('conflictRolledBack', locale), tone: 'caution' });
    queue.clearConflict();
  }, [queue, show, locale]);

  /**
   * The chamber's fee, for `FR-DOC-09`.
   *
   * Not in the queue state, and correctly so: the state is the event log
   * reduced, and a fee is not an event. Fetched once per session from the
   * roster, where `DB-P5` already copied it onto every booking.
   */
  const [feePoisha, setFeePoisha] = useState<number | null>(null);
  useEffect(() => {
    if (sessionId === null) return;

    void fetchSessionFee({
      apiBaseUrl: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1',
      token: readToken(),
      sessionId,
    })
      .then(setFeePoisha)
      .catch(() => {
        // Earnings are absent rather than zero. Nothing else on the screen
        // depends on this number (`FR-OFF-05`).
      });
  }, [sessionId]);

  const state = queue.state;
  const liveServing = state === null ? null : nowServing(state);
  const counts = state === null ? null : queueCounts(state);
  const waiting = state === null ? [] : waitingQueue(state);

  // --- the note being written ----------------------------------------------
  const [draft, setDraft] = useState<VisitDraft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [catalogue, setCatalogue] = useState<readonly CatalogueTest[]>([]);
  /**
   * One key per consultation, so a retry after a half-failed save replays the
   * same order rather than making a second set (`orderTests`).
   */
  const [testKey, setTestKey] = useState(() => crypto.randomUUID());
  // FR-DOC-08: the editor owns its encounter independently of the live queue.
  // Sensitive unsaved writing stays in memory; only explicit Save writes it.
  const [editor, setEditor] = useState<{
    entry: QueueEntry;
    sessionId: string;
    revision: string | null;
    loaded: boolean;
    saved: boolean;
    signed: boolean;
    conflict: boolean;
  } | null>(null);
  const serving = editor?.entry ?? null;
  const servingBookingId = serving?.bookingId ?? null;
  const changed = editor !== null && liveServing?.bookingId !== servingBookingId;
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const busyRef = useRef(false);
  const completedBooking = useRef<string | null>(null);
  const operationVersion = useRef(0);
  const [reload, setReload] = useState(0);
  const attempt = useRef<Parameters<typeof saveVisit>[0] | null>(null);
  const [uncertainSign, setUncertainSign] = useState(false);
  const [testRetries, setTestRetries] = useState<
    readonly {
      bookingId: string;
      serial: number;
      testCodes: readonly string[];
      idempotencyKey: string;
    }[]
  >([]);

  useEffect(() => {
    if (
      editor !== null ||
      liveServing === null ||
      sessionId === null ||
      liveServing.bookingId === completedBooking.current
    )
      return;
    setDraft(emptyDraft());
    setFailed(false);
    setTestKey(crypto.randomUUID());
    setEditor({
      entry: liveServing,
      sessionId,
      revision: null,
      loaded: false,
      saved: true,
      signed: false,
      conflict: false,
    });
  }, [editor, liveServing, sessionId]);

  useEffect(() => {
    if (servingBookingId === null) return;
    let cancelled = false;
    const version = operationVersion.current;
    void fetchConsultation({
      apiBaseUrl: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1',
      token: readToken(),
      bookingId: servingBookingId,
    })
      .then((result) => {
        if (
          cancelled ||
          version !== operationVersion.current ||
          editorRef.current?.entry.bookingId !== servingBookingId
        )
          return;
        const current = editorRef.current;
        if (
          result.patientId !== current.entry.patientId ||
          result.sessionId !== current.sessionId
        ) {
          setFailed(true);
          return;
        }
        if (!current.loaded) {
          setDraft(result.visit === null ? emptyDraft() : consultationDraft(result.visit));
          setEditor({
            ...current,
            loaded: true,
            saved: true,
            revision: result.visit?.revision ?? null,
            signed: result.visit?.signedAt != null,
          });
        } else if (current.revision !== (result.visit?.revision ?? null) && !busyRef.current) {
          // A reconnect checks the server but never hydrates over local writing.
          setEditor({ ...current, conflict: true });
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [servingBookingId, queue.connected, reload]);

  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (
        editorRef.current?.saved === false ||
        busyRef.current ||
        attempt.current !== null ||
        testRetries.length > 0
      ) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [testRetries]);

  // The catalogue is the hospital's and does not change during a session, so
  // it is fetched once. A failure leaves it empty and the chips absent, which
  // is better than chips that order a test nobody can price.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const tests = await fetchTestCatalogue({
          apiBaseUrl: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1',
          token: readToken(),
        });
        if (!cancelled) setCatalogue(tests);
      } catch {
        if (!cancelled) setCatalogue([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // `FR-DOC-04`: the rows as the API takes them, and any that are not right.
  const medicines = useMemo(() => readMedicineRows(draft.medicines), [draft.medicines]);

  const canSign = useMemo(
    () =>
      draft.diagnosisText.trim() !== '' ||
      draft.adviceTextBn.trim() !== '' ||
      draft.followUpDays !== null ||
      draft.followUpDate != null ||
      medicines.body.length > 0,
    [draft, medicines],
  );

  /**
   * `BTN-B05-PRINT`: the visit last signed with medicines, until the next one
   * is signed. Who and which booking, so the print reads the signed record
   * back rather than trusting what the screen held.
   */
  const [lastSigned, setLastSigned] = useState<{
    readonly patientId: string;
    readonly bookingId: string;
  } | null>(null);
  const { sheet, print } = usePrintSheet();
  const [printing, setPrinting] = useState(false);

  const printLast = useCallback(async () => {
    if (lastSigned === null) return;
    setPrinting(true);
    try {
      const records = await fetchRecords({
        apiBaseUrl: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1',
        token: readToken(),
        patientId: lastSigned.patientId,
        bookingId: lastSigned.bookingId,
      });
      const visit = records.visits.find((entry) => entry.bookingId === lastSigned.bookingId);
      if (visit === undefined) throw new Error('the signed visit was not in the record');
      print(
        prescriptionSheet(visit, {
          name: records.patient.fullName,
          ageYears: records.patient.ageYears,
          sex: records.patient.sex,
        }),
      );
    } catch {
      show({ title: t('rxPrintFailed', locale), tone: 'caution' });
    } finally {
      setPrinting(false);
    }
  }, [lastSigned, print, show, locale]);

  const submit = useCallback(
    async (sign: boolean) => {
      if (
        busyRef.current ||
        editor === null ||
        servingBookingId === null ||
        serving === null ||
        !editor.loaded
      )
        return;
      if (sign && changed && attempt.current === null) return;
      if (attempt.current !== null && attempt.current.sign !== sign) return;
      // The screen holds the buttons while a row is wrong; this is the same rule.
      if (medicines.problems.size > 0) return;

      busyRef.current = true;
      operationVersion.current += 1;
      setBusy(true);
      setFailed(false);
      const sent = attempt.current ?? {
        apiBaseUrl: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1',
        token: readToken(),
        bookingId: servingBookingId,
        patientId: serving.patientId,
        sessionId: editor.sessionId,
        expectedRevision: editor.revision,
        draft: {
          ...draft,
          followUpDate:
            draft.followUpDate ??
            (draft.followUpDays === null
              ? null
              : time.toDhakaDate(
                  time.fromDate(new Date(Date.now() + draft.followUpDays * 86_400_000)),
                )),
        },
        medicines: medicines.body,
        sign,
        idempotencyKey: crypto.randomUUID(),
      };
      attempt.current = sent;
      try {
        const result = await saveVisit({ ...sent, token: readToken() });
        if (editorRef.current?.entry.bookingId !== sent.bookingId) return;
        const current = editorRef.current;
        setEditor({
          ...current,
          revision: result.revision,
          saved: result.contentMatches,
          signed: result.signed,
          conflict: !result.contentMatches,
        });
        attempt.current = result.queueOutcome === 'retry_needed' ? sent : null;
        setUncertainSign(result.queueOutcome === 'retry_needed');
        if (sent.sign) await queue.refresh();
        if (!result.contentMatches) {
          // Another device signed different content. Its signature is final,
          // but this device's clinical writing has not been filed or discarded.
          attempt.current = null;
          setUncertainSign(false);
          show({ title: t('consultationSignedConflict', locale), tone: 'caution' });
          return;
        }

        // `APP_FLOW.md` B2: the ticked chips go to the lab queue on save, and
        // only once the visit exists — the order is attached to it.
        //
        // A failure here is *not* B2's failure: the record saved, and the
        // consultation is not un-done because a test order did not send. The
        // doctor is told which half failed and the chips stay ticked, so
        // saving again replays the same key and orders nothing twice.
        let testsSent = true;
        if (sent.draft.testCodes.length > 0) {
          try {
            await orderTests({
              apiBaseUrl: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1',
              token: readToken(),
              bookingId: sent.bookingId,
              testCodes: sent.draft.testCodes,
              idempotencyKey: testKey,
            });
          } catch {
            testsSent = false;
            setTestRetries((previous) => [
              ...previous.filter((p) => p.idempotencyKey !== testKey),
              {
                bookingId: sent.bookingId,
                serial: serving.serial,
                testCodes: sent.draft.testCodes,
                idempotencyKey: testKey,
              },
            ]);
            show({ title: t('testsNotSent', locale), tone: 'caution' });
          }
        }

        if (!result.signed) {
          if (testsSent) show({ title: t('draftSaved', locale), tone: 'positive' });
          return;
        }

        // The visit just signed is the one offered for printing, if it has
        // medicines; one signed without them takes the offer away.
        setLastSigned(
          sent.medicines.length > 0
            ? { patientId: sent.patientId, bookingId: sent.bookingId }
            : null,
        );

        // The queue came back with the record, so the screen already knows who
        // is next without waiting for the socket to say so.
        show({
          title: t(
            result.queueOutcome === 'changed'
              ? 'consultationSignedChanged'
              : result.queueOutcome === 'retry_needed'
                ? 'consultationSignedRetry'
                : 'consultationSigned',
            locale,
          ),
          tone: 'positive',
        });
        // Only a confirmed complete outcome can release this editor. A newer
        // socket state already held by the hook wins over any delayed receipt.
        if (result.queueOutcome === 'advanced' && testsSent) {
          completedBooking.current = sent.bookingId;
          setEditor(null);
          setDraft(emptyDraft());
        }
      } catch (error) {
        // B2's failure rule: not marked done, draft preserved, retry offered.
        setFailed(true);
        // A received server refusal has a known outcome. Network failures
        // freeze the sign body for result checking, including after reconnect.
        const refused = error instanceof RequestFailed && error.status < 500;
        if (refused) attempt.current = null;
        setUncertainSign(sent.sign && !refused);
        if (refused && editorRef.current !== null)
          setEditor({ ...editorRef.current, conflict: true });
      } finally {
        operationVersion.current += 1;
        busyRef.current = false;
        setBusy(false);
      }
    },
    [
      servingBookingId,
      serving,
      draft,
      medicines,
      testKey,
      show,
      locale,
      editor,
      changed,
      queue.refresh,
    ],
  );

  if (sessionId === null) {
    return <p className="p-6 text-body-md text-ink-muted">{t('loading', locale)}</p>;
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SessionHeader
        counts={counts}
        delayMinutes={state === null ? 0 : outstandingDelayMinutes(state, time.fromDate(now))}
        avgConsultSeconds={state?.rate.currentSeconds ?? null}
        plannedStart={state?.plan.plannedStart ?? null}
        plannedEnd={state?.plan.plannedEnd ?? null}
        feePoisha={feePoisha}
        lastServerTs={queue.lastServerTs}
        now={now}
        onDelay={() => {
          void queue.act('DELAY_DECLARED', { minutes: 30, reason: null, declaredBy: 'doctor' });
          show({ title: t('declareDelay', locale), tone: 'positive' });
        }}
        busy={queue.loading}
      />

      <main className="mx-auto grid w-full max-w-[1400px] flex-1 gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        {/* Left: who is here, and everything known about them. */}
        <div className="flex min-w-0 flex-col gap-5">
          {serving === null ? (
            <Card>
              <p className="text-body-md text-ink-secondary">{t('nobodyToSee', locale)}</p>
            </Card>
          ) : (
            <PatientPanel entry={serving} />
          )}

          {/* Keyed on who is in the chamber, so a consented history never
              outlives the patient it belongs to. And not shown until the
              queue has said who that is: drawn before, it was keyed "nobody",
              then remounted when the first state arrived — and a code typed
              in that moment was gone, with the button back to disabled. */}
          {state === null ? null : <ConsentScan key={servingBookingId ?? 'nobody'} />}

          <UpNext waiting={waiting} />
        </div>

        {/* Right: the record, and the one button that files it. */}
        <div className="flex min-w-0 flex-col gap-5">
          <VisitNote
            disabled={
              serving === null || busy || editor?.loaded !== true || editor.signed || uncertainSign
            }
            disabledReason={
              busy || editor?.loaded !== true
                ? t('loading', locale)
                : uncertainSign
                  ? t('consultationCheckSign', locale)
                  : editor.signed
                    ? t('consultationSigned', locale)
                    : t('nobodyToSee', locale)
            }
            catalogue={catalogue}
            draft={draft}
            onChange={(next) => {
              setDraft(next);
              if (editor !== null) setEditor({ ...editor, saved: false });
              attempt.current = null;
            }}
            canSign={canSign && !changed && editor?.conflict !== true}
            signBlockedReason={
              changed
                ? t('consultationChanged', locale)
                : editor?.conflict
                  ? t('consultationConflict', locale)
                  : null
            }
            medicineProblems={medicines.problems}
            failed={failed}
            onDraft={() => {
              void submit(false);
            }}
            onSign={() => {
              void submit(true);
            }}
          />

          {editor === null ? null : (
            <Card>
              <p data-testid="consultation-identity">
                {format('consultationEditing', locale, {
                  serial: formatNumber(editor.entry.serial, numerals),
                })}
              </p>
              {changed ? (
                <p role="alert" data-testid="consultation-changed">
                  {t('consultationChanged', locale)}
                </p>
              ) : null}
              {editor.conflict ? <p role="alert">{t('consultationConflict', locale)}</p> : null}
              {editor.signed ? <p>{t('consultationSigned', locale)}</p> : null}
              {editor.loaded ? null : (
                <Button variant="secondary" onClick={() => setReload((n) => n + 1)}>
                  {t('retry', locale)}
                </Button>
              )}
              {uncertainSign || (editor.signed && !changed) ? (
                <Button
                  data-testid="consultation-retry-sign"
                  loading={busy}
                  onClick={() => {
                    void submit(true);
                  }}
                >
                  {t('consultationCheckSign', locale)}
                </Button>
              ) : null}
              {editor.conflict || failed ? (
                <Button
                  variant="secondary"
                  data-testid="consultation-review"
                  onClick={() => {
                    if (
                      busyRef.current ||
                      uncertainSign ||
                      !window.confirm(t('consultationReloadConfirm', locale))
                    )
                      return;
                    attempt.current = null;
                    operationVersion.current += 1;
                    setEditor({ ...editor, loaded: false, saved: false, conflict: false });
                    setReload((n) => n + 1);
                  }}
                >
                  {t('consultationReview', locale)}
                </Button>
              ) : null}
              {changed && !busy && !uncertainSign ? (
                <Button
                  variant="secondary"
                  data-testid="consultation-switch"
                  onClick={() => {
                    if (!editor.saved && !window.confirm(t('consultationDiscardConfirm', locale)))
                      return;
                    attempt.current = null;
                    setEditor(null);
                    setDraft(emptyDraft());
                  }}
                >
                  {t(editor.saved ? 'consultationContinue' : 'consultationDiscard', locale)}
                </Button>
              ) : null}
            </Card>
          )}
          {testRetries.map((testRetry) => (
            <Card key={testRetry.idempotencyKey}>
              <p data-testid="consultation-test-identity">
                {`${t('orderTests', locale)} · ${t('colSerial', locale)} ${formatNumber(testRetry.serial, numerals)}`}
              </p>
              <p>{t('testsNotSent', locale)}</p>
              <Button
                variant="secondary"
                data-testid="consultation-retry-tests"
                onClick={() => {
                  void orderTests({
                    apiBaseUrl:
                      process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1',
                    token: readToken(),
                    ...testRetry,
                  })
                    .then(() =>
                      setTestRetries((previous) =>
                        previous.filter((p) => p.idempotencyKey !== testRetry.idempotencyKey),
                      ),
                    )
                    .catch(() => show({ title: t('testsNotSent', locale), tone: 'caution' }));
                }}
              >
                {t('retry', locale)}
              </Button>
            </Card>
          ))}

          {lastSigned === null ? null : (
            <Card>
              <Button
                variant="secondary"
                loading={printing}
                data-testid="print-last"
                onClick={() => {
                  void printLast();
                }}
              >
                {t('rxPrintLast', locale)}
              </Button>
            </Card>
          )}
          {sheet}

          <OfflineBlock
            connected={queue.connected}
            pendingCount={queue.pendingCount}
            lastServerTs={queue.lastServerTs}
            stuckCount={queue.stuckCount}
            onRetryStuck={() => {
              void queue.retryStuck();
            }}
            onDiscardStuck={() => {
              void queue.discardStuck();
            }}
            durable={queue.durable}
            locale={locale}
            now={now}
          />
        </div>
      </main>
    </div>
  );
}

/**
 * The session header (`FR-DOC-01`): seen, waiting, average duration, and
 * whether the chamber is running late.
 *
 * `BTN-B05-DELAY` lives here because a doctor declaring a delay is doing it
 * about the *session*, not about the patient in front of them — and because
 * `FR-DOC-02` exists so they can do it without phoning reception.
 */
function SessionHeader({
  counts,
  delayMinutes,
  avgConsultSeconds,
  plannedStart,
  plannedEnd,
  feePoisha,
  lastServerTs,
  now,
  onDelay,
  busy,
}: {
  readonly counts: ReturnType<typeof queueCounts> | null;
  readonly delayMinutes: number;
  readonly avgConsultSeconds: number | null;
  readonly plannedStart: string | null;
  readonly plannedEnd: string | null;
  readonly feePoisha: number | null;
  readonly lastServerTs: string | null;
  readonly now: Date;
  readonly onDelay: () => void;
  readonly busy: boolean;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const late = delayMinutes > 0;

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-3 p-5">
        {/* FR-BRD-12 (plan K4): the hospital's own, powered by MedLiveBD. */}
        <WorkspaceBrandMark locale={locale} />
        <div className="min-w-0">
          <h1 className="font-reading text-title-md">{t('doctorConsole', locale)}</h1>
          <p className="text-body-sm tabular-nums text-ink-muted">
            {plannedStart === null || plannedEnd === null
              ? t('notStarted', locale)
              : `${t('plannedWindow', locale)} ${formatClock(plannedStart, numerals)}–${formatClock(plannedEnd, numerals)}`}
          </p>
        </div>

        {/* A11Y-03: the state is a word, never only a colour. */}
        <Chip tone={late ? 'caution' : 'positive'}>
          {late
            ? `${t('runningLate', locale)} · ${formatNumber(delayMinutes, numerals)} ${t('minutesShort', locale)}`
            : t('onTime', locale)}
        </Chip>

        <dl className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Stat label={t('countSeen', locale)} value={counts === null ? null : counts.done} />
          <Stat label={t('countWaiting', locale)} value={counts === null ? null : counts.waiting} />
          <Stat
            label={t('currentRate', locale)}
            value={avgConsultSeconds === null ? null : Math.round(avgConsultSeconds / 60)}
            unit={t('minutesShort', locale)}
          />
          {/* `FR-DOC-09` session earnings: what has actually been seen, at this
              chamber's fee. Absent rather than zero when the fee is unknown. */}
          {feePoisha === null || counts === null ? null : (
            <div>
              <dt className="text-caption text-ink-muted">{t('sessionEarnings', locale)}</dt>
              <dd className="text-title-sm font-semibold tabular-nums">
                {formatTaka(feePoisha * counts.done, numerals)}
              </dd>
            </div>
          )}
        </dl>

        {/*
          DoD §5.8: every one of the figures above is live — seen, waiting, the
          rolling average, and the money derived from them. A doctor deciding
          whether to speed up must know whether the numbers are this minute's or
          from before the network dropped (`FR-OFF-03`).
        */}
        <FreshnessLine
          asOf={lastServerTs === null ? null : new Date(lastServerTs)}
          now={now}
          labels={{
            justNow: t('updatedJustNow', locale),
            ago: t('updatedAgo', locale),
            never: t('neverSynced', locale),
            stale: t('staleWarning', locale),
          }}
          formatMinutes={(value) => formatAge(value, locale, numerals)}
        />

        <div className="ms-auto flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={onDelay} loading={busy}>
            {t('declareDelay', locale)}
          </Button>
          <ConsoleLanguageSwitch className="" />
        </div>
      </div>
    </header>
  );
}

function Stat({
  label,
  value,
  unit,
}: {
  readonly label: string;
  readonly value: number | null;
  readonly unit?: string;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  return (
    <div>
      <dt className="text-caption text-ink-muted">{label}</dt>
      <dd className="text-title-sm font-semibold tabular-nums">
        {value === null ? '—' : formatNumber(value, numerals)}
        {unit === undefined || value === null ? '' : ` ${unit}`}
      </dd>
    </div>
  );
}

/**
 * `INP-B05-DX`, `INP-B05-ADVICE`, `SEL-B05-FOLLOWUP`, and the two buttons.
 *
 * The primary is never silently disabled (`FRONTEND.md` §5.1): when there is
 * nothing to sign it carries the reason, so a doctor is told what is missing
 * rather than left tapping a dead control.
 */
function VisitNote({
  disabled,
  disabledReason,
  catalogue,
  draft,
  onChange,
  canSign,
  signBlockedReason,
  medicineProblems,
  failed,
  onDraft,
  onSign,
}: {
  readonly disabled: boolean;
  readonly disabledReason: string;
  /** The hospital's test catalogue; empty means no chips (`BTN-B05-TEST`). */
  readonly catalogue: readonly CatalogueTest[];
  readonly draft: VisitDraft;
  readonly onChange: (draft: VisitDraft) => void;
  readonly canSign: boolean;
  readonly signBlockedReason: string | null;
  /** Rows of `TBL-B05-RX` that are not right yet; the save waits for them. */
  readonly medicineProblems: ReadonlyMap<string, MedicineRowProblems>;
  readonly failed: boolean;
  readonly onDraft: () => void;
  readonly onSign: () => void;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  return (
    <Card>
      <div className="flex flex-col gap-4">
        <h2 className="font-reading text-title-sm">{t('visitNote', locale)}</h2>

        {failed ? (
          <p
            role="alert"
            data-testid="visit-failed"
            className="rounded-sm bg-alert-100 px-3 py-2 text-body-sm text-alert-700"
          >
            {t('visitSaveFailed', locale)}
          </p>
        ) : null}

        <Input
          label={t('diagnosis', locale)}
          helper={t('diagnosisHint', locale)}
          density="console"
          data-testid="visit-diagnosis"
          value={draft.diagnosisText}
          disabled={disabled}
          onChange={(event) => {
            onChange({ ...draft, diagnosisText: event.target.value });
          }}
        />

        {/* A textarea rather than an Input: advice runs to several sentences and
            a single-line field would hide most of what the patient will read. */}
        <div className="flex flex-col gap-2">
          <label htmlFor="advice" className="font-ui text-body-sm font-semibold text-ink">
            {t('adviceBn', locale)}
          </label>
          <textarea
            id="advice"
            data-testid="visit-advice"
            rows={4}
            value={draft.adviceTextBn}
            disabled={disabled}
            onChange={(event) => {
              onChange({ ...draft, adviceTextBn: event.target.value });
            }}
            className="w-full rounded-md border border-line-strong bg-surface p-3 text-body-md text-ink disabled:opacity-60"
          />
          <p className="text-caption text-ink-muted">{t('adviceHint', locale)}</p>
        </div>

        {/* `TBL-B05-RX`, `BTN-B05-ADDRX` (`FR-DOC-04`, plan R2). */}
        <MedicineRows
          rows={draft.medicines}
          problems={medicineProblems}
          disabled={disabled}
          onChange={(rows: readonly MedicineRow[]) => {
            onChange({ ...draft, medicines: rows });
          }}
        />

        {/* `BTN-B05-TEST` (`FR-DOC-06`). Absent when the hospital has no
            catalogue, rather than an empty box. */}
        {catalogue.length > 0 ? (
          <fieldset className="flex flex-col gap-2" data-testid="visit-tests">
            <legend className="font-ui text-body-sm font-semibold text-ink">
              {t('orderTests', locale)}
            </legend>
            <div className="flex flex-wrap gap-2">
              {catalogue.map((test) => {
                const ticked = draft.testCodes.includes(test.code);
                return (
                  <FilterChip
                    key={test.code}
                    selected={ticked}
                    onToggle={() => {
                      if (disabled) return;
                      onChange({
                        ...draft,
                        testCodes: ticked
                          ? draft.testCodes.filter((code) => code !== test.code)
                          : [...draft.testCodes, test.code],
                      });
                    }}
                  >
                    {localName(locale, test.nameBn, test.nameEn)}
                  </FilterChip>
                );
              })}
            </div>
            <p className="text-caption text-ink-muted">
              {draft.testCodes.length === 0
                ? t('orderTestsHint', locale)
                : format('orderTestsCount', locale, {
                    count: formatNumber(draft.testCodes.length, numerals),
                  })}
            </p>
          </fieldset>
        ) : null}

        {/* `CHIP-B05-SIGNAL` (`FR-GOV-03`): the one thing about this visit the
            district counts. Optional and single — most consultations are none
            of the three, and "none" is the first choice so that is the easy
            tap. It is a reporting flag, not a diagnosis: the text above stays
            the record, and the patient's wallet does not show this. */}
        <fieldset className="flex flex-col gap-2" data-testid="visit-signal">
          <legend className="font-ui text-body-sm font-semibold text-ink">
            {t('visitSignal', locale)}
          </legend>
          <div className="flex flex-wrap gap-2">
            <FollowUpChoice
              label={t('visitSignalNone', locale)}
              active={draft.symptomSignal === null}
              disabled={disabled}
              testId="visit-signal-none"
              onSelect={() => {
                onChange({ ...draft, symptomSignal: null });
              }}
            />
            {SYMPTOM_SIGNALS.map((signal) => (
              <FollowUpChoice
                key={signal}
                label={symptomSignalName(signal, locale)}
                active={draft.symptomSignal === signal}
                disabled={disabled}
                testId={`visit-signal-${signal}`}
                onSelect={() => {
                  onChange({ ...draft, symptomSignal: signal });
                }}
              />
            ))}
          </div>
          <p className="text-caption text-ink-muted">{t('visitSignalHint', locale)}</p>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="font-ui text-body-sm font-semibold text-ink">
            {t('followUp', locale)}
          </legend>
          <div className="flex flex-wrap gap-2">
            <FollowUpChoice
              label={t('followUpNone', locale)}
              active={draft.followUpDays === null && draft.followUpDate == null}
              disabled={disabled}
              onSelect={() => {
                onChange({ ...draft, followUpDays: null, followUpDate: null });
              }}
            />
            {FOLLOW_UP_CHOICES.map((days) => (
              <FollowUpChoice
                key={days}
                label={t('followUpDays', locale).replace('{days}', formatNumber(days, numerals))}
                active={draft.followUpDays === days}
                disabled={disabled}
                onSelect={() => {
                  onChange({ ...draft, followUpDays: days, followUpDate: null });
                }}
              />
            ))}
          </div>
          {draft.followUpDate == null ? null : (
            <p>{format('consultationFollowUpDate', locale, { date: draft.followUpDate })}</p>
          )}
        </fieldset>

        <div className="flex flex-wrap gap-3">
          {/*
            `ButtonProps` is a discriminated union: disabling requires a reason
            (§5.1), so `disabled={someBoolean}` does not compile and every
            branch below carries the sentence a doctor should read instead of a
            dead control.
          */}
          {disabled || medicineProblems.size > 0 ? (
            <Button
              variant="secondary"
              size="lg"
              disabled
              disabledReason={disabled ? disabledReason : t('rxFixFirst', locale)}
              data-testid="save-draft"
            >
              {t('saveDraft', locale)}
            </Button>
          ) : (
            <Button variant="secondary" size="lg" data-testid="save-draft" onClick={onDraft}>
              {t('saveDraft', locale)}
            </Button>
          )}

          {disabled || !canSign || medicineProblems.size > 0 ? (
            <Button
              size="lg"
              disabled
              disabledReason={
                disabled
                  ? disabledReason
                  : medicineProblems.size > 0
                    ? t('rxFixFirst', locale)
                    : (signBlockedReason ?? t('needSomethingToSign', locale))
              }
              data-testid="sign-and-next"
            >
              {t('signAndNext', locale)}
            </Button>
          ) : (
            <Button size="lg" data-testid="sign-and-next" onClick={onSign}>
              {t('signAndNext', locale)}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function FollowUpChoice({
  label,
  active,
  disabled,
  onSelect,
  testId,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly disabled: boolean;
  readonly onSelect: () => void;
  readonly testId?: string;
}): ReactNode {
  return (
    <button
      type="button"
      // A radio group in behaviour, so the choice is announced as one.
      aria-pressed={active}
      disabled={disabled}
      onClick={onSelect}
      data-testid={testId}
      className={`min-h-touch rounded-pill border px-4 text-body-sm ${
        active
          ? 'border-brand-600 bg-brand-100 font-semibold text-brand-700'
          : 'border-line-strong bg-surface text-ink'
      } disabled:opacity-60`}
    >
      {label}
    </button>
  );
}

/** Who the doctor sees after this one. Three is enough to pace a chamber. */
function UpNext({ waiting }: { readonly waiting: readonly QueueEntry[] }): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  if (waiting.length === 0) return null;

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <h2 className="text-title-sm">{t('waitingNext', locale)}</h2>
        <ul className="flex flex-wrap gap-2">
          {waiting.slice(0, 3).map((entry) => (
            <li key={entry.bookingId}>
              <Chip tone="neutral">{formatNumber(entry.serial, numerals)}</Chip>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function emptyDraft(): VisitDraft {
  return {
    diagnosisText: '',
    adviceTextBn: '',
    followUpDays: null,
    testCodes: [],
    symptomSignal: null,
    medicines: [],
  };
}

/**
 * The chamber this console is open on.
 *
 * Read from the URL after mount, for the same reason reception does: the server
 * has no `location`, and reading it during render makes the first client render
 * disagree with the server's.
 */
function useSessionId(): string | null {
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    setSessionId(new URLSearchParams(globalThis.location.search).get('session'));
  }, []);

  return sessionId;
}
