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

import { customFollowUpDays, followUpDateIn, followUpDateLabel } from '@platform/client';
import {
  nowServing,
  outstandingDelayMinutes,
  queueCounts,
  readMedicineRows,
  time,
} from '@platform/domain';
import {
  format,
  CONSOLE,
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
  FreshnessLine,
  ToastProvider,
  useToast,
  useLocale,
  usePrintSheet,
  ConsoleAction,
  ConsoleStatus,
  Sheet,
} from '@platform/ui';

import { ConsentScan } from '@/components/ConsentScan';
import { DoctorRecord } from '@/components/DoctorRecord';
import { DoctorWorkspace } from '@/components/DoctorWorkspace';
import { OfflineBlock } from '@/components/OfflineBlock';
import { PatientPanel } from '@/components/PatientPanel';
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
} from '@/lib/visits';

function readToken() {
  return readDemoSession()?.token ?? null;
}

export function DoctorConsole() {
  return (
    <ToastProvider placement="console" viewportClassName="doc-toast-viewport">
      <DoctorBody />
    </ToastProvider>
  );
}

function DoctorBody() {
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
  const [feePoisha, setFeePoisha] = useState(null);
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

  // --- the note being written ----------------------------------------------
  const [draft, setDraft] = useState(emptyDraft);
  const [signOpen, setSignOpen] = useState(false);
  const [signFollowUpDate, setSignFollowUpDate] = useState(null);
  const [delayOpen, setDelayOpen] = useState(false);
  const [patientRead, setPatientRead] = useState(null);
  const receiveRecords = useCallback(
    (bookingId, records) => setPatientRead({ bookingId, records }),
    [],
  );
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [catalogue, setCatalogue] = useState([]);
  /**
   * One key per consultation, so a retry after a half-failed save replays the
   * same order rather than making a second set (`orderTests`).
   */
  const [testKey, setTestKey] = useState(() => crypto.randomUUID());
  // FR-DOC-08: the editor owns its encounter independently of the live queue.
  // Sensitive unsaved writing stays in memory; only explicit Save writes it.
  const [editor, setEditor] = useState(null);
  const serving = editor?.entry ?? null;
  const servingBookingId = serving?.bookingId ?? null;
  const records = patientRead?.bookingId === servingBookingId ? patientRead.records : null;
  const invalidFollowUp =
    draft.customFollowUp !== undefined && customFollowUpDays(draft.customFollowUp) === null;
  const changed = editor !== null && liveServing?.bookingId !== servingBookingId;
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const busyRef = useRef(false);
  const completedBooking = useRef(null);
  const operationVersion = useRef(0);
  const [reload, setReload] = useState(0);
  const attempt = useRef(null);
  const [uncertainSign, setUncertainSign] = useState(false);
  const [testRetries, setTestRetries] = useState([]);

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
    const protect = (event) => {
      if (
        editorRef.current?.saved === false ||
        busyRef.current ||
        attempt.current !== null ||
        testRetries.length > 0 ||
        invalidFollowUp
      ) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [testRetries, invalidFollowUp]);

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
  const [lastSigned, setLastSigned] = useState(null);
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
    async (sign, reviewedFollowUpDate) => {
      if (
        busyRef.current ||
        editor === null ||
        servingBookingId === null ||
        serving === null ||
        !editor.loaded
      )
        return;
      if (sign && changed && attempt.current === null) return;
      if (sign && invalidFollowUp && attempt.current === null) return;
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
            sign && reviewedFollowUpDate !== undefined
              ? reviewedFollowUpDate
              : (draft.followUpDate ??
                (draft.followUpDays === null ? null : followUpDateIn(draft.followUpDays))),
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
        // FR-DOC-07/08: keep the acknowledged calendar date exact across
        // Dhaka midnight. A relative preview must not drift while labelled saved.
        setDraft(sent.draft);

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
          if (testsSent)
            show({
              title: t(invalidFollowUp ? 'doctorSavedWithoutFollowUp' : 'draftSaved', locale),
              tone: invalidFollowUp ? 'caution' : 'positive',
            });
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
      invalidFollowUp,
    ],
  );

  if (sessionId === null) {
    return <p className="p-6 text-body-md text-ink-muted">{t('loading', locale)}</p>;
  }

  const disabled =
    serving === null || busy || editor?.loaded !== true || editor.signed || uncertainSign;
  const disabledReason =
    busy || editor?.loaded !== true
      ? t('loading', locale)
      : uncertainSign
        ? t('consultationCheckSign', locale)
        : editor.signed
          ? t('consultationSigned', locale)
          : t('nobodyToSee', locale);
  const signReason = disabled
    ? disabledReason
    : changed
      ? t('consultationChanged', locale)
      : editor?.conflict
        ? t('consultationConflict', locale)
        : failed && attempt.current !== null && !attempt.current.sign
          ? t('doctorDraftRetryFirst', locale)
          : medicines.problems.size > 0
            ? t('rxFixFirst', locale)
            : invalidFollowUp
              ? t('doctorFollowUpInvalid', locale)
              : !canSign
                ? t('needSomethingToSign', locale)
                : null;
  const excluded = editor?.saved === true && invalidFollowUp && !failed && !busy;
  const statusKey = busy
    ? attempt.current?.sign
      ? 'doctorSigning'
      : 'doctorSaving'
    : uncertainSign
      ? 'doctorSaveFailed'
      : editor?.signed
        ? editor.conflict
          ? 'consultationSignedConflict'
          : 'consultationSigned'
        : failed
          ? 'doctorSaveFailed'
          : excluded
            ? 'doctorSavedWithoutFollowUp'
            : editor?.saved && editor.revision !== null
              ? 'draftSaved'
              : 'doctorNotSaved';
  return (
    <DoctorWorkspace
      queue={queue}
      sessionId={sessionId}
      patient={serving}
      records={records}
      status={
        <ConsoleStatus
          tone={
            failed || excluded || uncertainSign || editor?.conflict
              ? 'caution'
              : editor?.signed || (editor?.saved && editor.revision !== null)
                ? 'positive'
                : 'neutral'
          }
          label={CONSOLE[statusKey]}
        />
      }
      sessionHeader={
        <>
          <SessionHeader
            counts={counts}
            delayMinutes={state === null ? 0 : outstandingDelayMinutes(state, time.fromDate(now))}
            avgConsultSeconds={state?.rate.currentSeconds ?? null}
            plannedStart={state?.plan.plannedStart ?? null}
            plannedEnd={state?.plan.plannedEnd ?? null}
            feePoisha={feePoisha}
            lastServerTs={queue.lastServerTs}
            now={now}
            onDelay={() => setDelayOpen(true)}
            busy={queue.loading}
          />
          <Sheet
            console
            open={delayOpen}
            onOpenChange={setDelayOpen}
            title={t('doctorDelayTitle', locale)}
            description={t('doctorDelayEffect', locale)}
            dismissible={false}
          >
            <div className="cf-confirm-actions">
              <ConsoleAction
                label={CONSOLE.foundationGoBack}
                variant="secondary"
                onClick={() => setDelayOpen(false)}
              />
              <ConsoleAction
                label={CONSOLE.declareDelay}
                data-testid="doctor-confirm-delay"
                onClick={() => {
                  setDelayOpen(false);
                  void queue.act('DELAY_DECLARED', {
                    minutes: 30,
                    reason: null,
                    declaredBy: 'doctor',
                  });
                  show({ title: t('doctorDelayQueued', locale), tone: 'neutral' });
                }}
              />
            </div>
          </Sheet>
        </>
      }
      information={
        <div data-help-topic="history">
          {serving === null ? null : (
            <PatientPanel
              key={`patient-${servingBookingId}`}
              entry={serving}
              compact
              onRecords={receiveRecords}
            />
          )}
          {state === null ? null : <ConsentScan key={`consent-${servingBookingId ?? 'nobody'}`} />}{' '}
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
      }
      record={
        <DoctorRecord
          disabled={disabled}
          catalogue={catalogue}
          draft={draft}
          now={now}
          medicineProblems={medicines.problems}
          failed={failed}
          excluded={excluded}
          onChange={(next) => {
            setDraft(next);
            if (editor !== null) setEditor({ ...editor, saved: false });
            attempt.current = null;
          }}
        />
      }
      recovery={
        <div>
          {' '}
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
                    if (
                      (!editor.saved || invalidFollowUp) &&
                      !window.confirm(
                        t(
                          editor.saved && invalidFollowUp
                            ? 'doctorDiscardFollowUpConfirm'
                            : 'consultationDiscardConfirm',
                          locale,
                        ),
                      )
                    )
                      return;
                    attempt.current = null;
                    setEditor(null);
                    setDraft(emptyDraft());
                  }}
                >
                  {t(
                    editor.saved && invalidFollowUp
                      ? 'doctorDiscardFollowUp'
                      : editor.saved
                        ? 'consultationContinue'
                        : 'consultationDiscard',
                    locale,
                  )}
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
          {sheet}
        </div>
      }
      printLast={
        <div>
          {' '}
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
        </div>
      }
      footer={
        <>
          <p className="doc-footer-status" role="status" data-help-topic="draft">
            {t(statusKey, locale)}
            {signReason === null ? '' : ' · ' + signReason}
          </p>
          <div className="doc-footer-actions">
            <ConsoleAction
              label={CONSOLE.saveDraft}
              variant="secondary"
              data-testid="save-draft"
              {...(disabled || medicines.problems.size > 0
                ? {
                    disabled: true,
                    disabledReason: disabled ? disabledReason : t('rxFixFirst', locale),
                  }
                : {})}
              onClick={() => {
                void submit(false);
              }}
            />
            <Sheet
              console
              open={signOpen}
              onOpenChange={setSignOpen}
              title={t('doctorSignTitle', locale)}
              description={t('doctorSignEffect', locale)}
              dismissible={false}
              trigger={
                <ConsoleAction
                  label={CONSOLE.doctorSignAndNext}
                  data-testid="sign-and-next"
                  {...(signReason !== null ? { disabled: true, disabledReason: signReason } : {})}
                  onClick={() => {
                    // FR-DOC-07/08: the reviewed calendar date must remain
                    // exact if Bangladesh midnight passes before confirmation.
                    setSignFollowUpDate(
                      draft.followUpDate ??
                        (draft.followUpDays === null ? null : followUpDateIn(draft.followUpDays)),
                    );
                    setSignOpen(true);
                  }}
                />
              }
            >
              <div data-testid="doctor-sign-summary">
                <h3>
                  {format('doctorRecordFor', locale, {
                    serial: serving === null ? '?' : formatNumber(serving.serial, numerals),
                  })}
                </h3>
                <strong>{records?.patient.fullName ?? t('patientPanel', locale)}</strong>
                <dl>
                  <dt>{t('diagnosis', locale)}</dt>
                  <dd>{draft.diagnosisText || t('noneDeclared', locale)}</dd>
                  <dt>{t('rxTitle', locale)}</dt>
                  <dd>
                    {draft.medicines
                      .filter((m) => m.name.trim() !== '')
                      .map((m) => m.name)
                      .join(', ') || t('rxNone', locale)}
                  </dd>
                  <dt>{t('orderTests', locale)}</dt>
                  <dd>
                    {draft.testCodes
                      .map((code) => catalogue.find((c) => c.code === code))
                      .map((c) => (c === undefined ? '?' : localName(locale, c.nameBn, c.nameEn)))
                      .join(', ') || t('noneDeclared', locale)}
                  </dd>
                  <dt>{t('adviceBn', locale)}</dt>
                  <dd>{draft.adviceTextBn || t('noneDeclared', locale)}</dd>
                  <dt>{t('followUp', locale)}</dt>
                  <dd data-testid="doctor-sign-follow-up">
                    {signFollowUpDate === null
                      ? t('followUpNone', locale)
                      : followUpDateLabel(signFollowUpDate, locale)}
                  </dd>
                  <dt>{t('visitSignal', locale)}</dt>
                  <dd>
                    {draft.symptomSignal === null
                      ? t('visitSignalNone', locale)
                      : symptomSignalName(draft.symptomSignal, locale)}
                  </dd>
                </dl>
              </div>
              {signReason === null ? null : <p role="alert">{signReason}</p>}
              <div className="cf-confirm-actions">
                <ConsoleAction
                  label={CONSOLE.doctorBackToRecord}
                  variant="secondary"
                  onClick={() => setSignOpen(false)}
                />
                <ConsoleAction
                  label={CONSOLE.doctorSignConfirm}
                  data-testid="doctor-confirm-sign"
                  {...(signReason !== null ? { disabled: true, disabledReason: signReason } : {})}
                  onClick={() => {
                    setSignOpen(false);
                    void submit(true, signFollowUpDate);
                  }}
                />
              </div>
            </Sheet>
          </div>
        </>
      }
    />
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
}) {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const late = delayMinutes > 0;

  return (
    <header className="doc-session">
      <div className="doc-session">
        <div className="min-w-0">
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
        </div>
      </div>
    </header>
  );
}

function Stat({ label, value, unit }) {
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

function emptyDraft() {
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
function useSessionId() {
  const [sessionId, setSessionId] = useState(null);

  useEffect(() => {
    setSessionId(new URLSearchParams(globalThis.location.search).get('session'));
  }, []);

  return sessionId;
}
