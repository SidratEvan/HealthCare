'use client';

/** Presentation only; the encounter and all writes remain in Batch 4A's
 * controller (FR-DOC-03/08/10, FR-BRD-12, GR-06).
 */
import { useEffect, useState } from 'react';

import { nowServing, waitingQueue } from '@platform/domain';
import { CONSOLE, formatClock, formatNumber, numeralsFor, t } from '@platform/i18n';
import { ConsoleAction, ConsoleHelp, ConsoleStatus, Sheet, useLocale } from '@platform/ui';

import { ConsoleWorkspaceFrame } from '@/components/ConsoleWorkspaceFrame';
import { DemoBanner } from '@/components/DemoBanner';
import { readDemoSession } from '@/lib/demo';
import { fetchPatientNames } from '@/lib/roster';
import '@platform/ui/console-doctor.css';

export const doctorHelp = {
  id: 'doctor',
  title: CONSOLE.roleDoctor,
  steps: [
    CONSOLE.doctorHelpIdentity,
    CONSOLE.doctorHelpHistory,
    CONSOLE.doctorHelpNotes,
    CONSOLE.doctorHelpDraft,
    CONSOLE.doctorHelpTests,
    CONSOLE.doctorHelpFollowUp,
    CONSOLE.doctorHelpSign,
    CONSOLE.doctorHelpErrors,
  ],
};
const topics = {
  identity: {
    id: 'doctor-identity',
    title: CONSOLE.patientPanel,
    steps: [CONSOLE.doctorHelpIdentity, CONSOLE.doctorHelpErrors],
  },
  history: { id: 'doctor-history', title: CONSOLE.pastVisits, steps: [CONSOLE.doctorHelpHistory] },
  notes: {
    id: 'doctor-notes',
    title: CONSOLE.visitNote,
    steps: [CONSOLE.doctorHelpNotes, CONSOLE.doctorHelpDraft],
  },
  tests: { id: 'doctor-tests', title: CONSOLE.orderTests, steps: [CONSOLE.doctorHelpTests] },
  followup: { id: 'doctor-followup', title: CONSOLE.followUp, steps: [CONSOLE.doctorHelpFollowUp] },
  signal: { id: 'doctor-signal', title: CONSOLE.visitSignal, steps: [CONSOLE.visitSignalHint] },
  draft: {
    id: 'doctor-draft',
    title: CONSOLE.saveDraft,
    steps: [CONSOLE.doctorHelpDraft, CONSOLE.doctorHelpErrors],
  },
  sign: {
    id: 'doctor-sign',
    title: CONSOLE.signAndNext,
    steps: [CONSOLE.doctorHelpSign, CONSOLE.doctorHelpErrors],
  },
};

export function DoctorWorkspace({
  queue,
  sessionId,
  patient,
  records,
  status,
  sessionHeader,
  information,
  record,
  footer,
  recovery,
  printLast,
}) {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const session = readDemoSession();
  const [names, setNames] = useState(new Map());
  const [namesFailed, setNamesFailed] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [seenOpen, setSeenOpen] = useState(false);
  const [helpTopic, setHelpTopic] = useState(null);
  const activateHelp = (target) => {
    const topic =
      target instanceof Element
        ? target.closest('[data-help-topic]')?.getAttribute('data-help-topic')
        : null;
    if (topic != null && Object.hasOwn(topics, topic)) setHelpTopic(topic);
  };
  useEffect(() => {
    let cancelled = false;
    void fetchPatientNames({
      apiBaseUrl: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1',
      token: readDemoSession()?.token ?? null,
      sessionId,
    })
      .then((result) => {
        if (!cancelled) {
          setNames(result);
          setNamesFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNames(new Map());
          setNamesFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, queue.state?.lastSeq, queue.connected]);
  const live = queue.state === null ? null : nowServing(queue.state);
  const waiting = queue.state === null ? [] : waitingQueue(queue.state);
  const seen = queue.state?.entries.filter((e) => e.status === 'done') ?? [];
  const row = (entry, current = false) => (
    <li key={entry.bookingId} className={`doc-queue-row${current ? ' doc-queue-current' : ''}`}>
      <span className="doc-queue-serial">{formatNumber(entry.serial, numerals)}</span>
      <div>
        <strong>{names.get(entry.patientId) ?? '—'}</strong>
        <small>
          {current
            ? t('statusInChamber', locale)
            : entry.status === 'done'
              ? t('countSeen', locale)
              : entry.late !== null
                ? t('statusLate', locale)
                : entry.arrivedAt !== null
                  ? t('statusArrived', locale)
                  : t('statusBooked', locale)}
          {entry.doneAt === null ? '' : ` · ${formatClock(entry.doneAt, numerals)}`}
        </small>
      </div>
    </li>
  );
  const queueContents = (
    <div className="doc-queue-content">
      <h2>{t('doctorQueueHere', locale)}</h2>
      {live === null ? <p>{t('nobodyToSee', locale)}</p> : <ul>{row(live, true)}</ul>}
      <h2>
        {t('doctorQueueWaiting', locale)} · {formatNumber(waiting.length, numerals)}
      </h2>
      <ul>{waiting.map((entry) => row(entry))}</ul>
      {namesFailed ? <p role="status">{t('doctorQueueNamesMissing', locale)}</p> : null}
      <button
        type="button"
        className="doc-seen-toggle"
        aria-expanded={seenOpen}
        onClick={() => setSeenOpen((value) => !value)}
      >
        {t('doctorQueueSeen', locale)} · {formatNumber(seen.length, numerals)}
      </button>
      {seenOpen ? <ul>{seen.map((entry) => row(entry))}</ul> : null}
      <p className="doc-queue-note">{t('doctorQueueReadOnly', locale)}</p>
      {printLast}
    </div>
  );
  if (session === null) return null;
  const intake = records?.intake;
  const allergy = !intake?.asked
    ? t('intakeNotAsked', locale)
    : intake.allergiesBn.length === 0
      ? t('noneDeclared', locale)
      : intake.allergiesBn.join(', ');
  return (
    <div
      className="doctor-workspace"
      data-testid="doctor-workspace"
      onFocusCapture={(event) => activateHelp(event.target)}
      onPointerDownCapture={(event) => activateHelp(event.target)}
    >
      <ConsoleWorkspaceFrame
        session={session}
        workspace={CONSOLE.doctorConsole}
        rail="navQueue"
        navigation={[]}
        actions={
          <>
            <ConsoleStatus
              tone={queue.connected ? 'positive' : 'caution'}
              label={queue.connected ? CONSOLE.online : CONSOLE.offline}
            />
            <ConsoleHelp topic={helpTopic === null ? doctorHelp : topics[helpTopic]} />
            <small>{session.staffName}</small>
          </>
        }
      >
        <div className="doc-session-wrap">
          <DemoBanner />
          <div className="doc-queue-trigger">
            {' '}
            <Sheet
              console
              trigger={
                <ConsoleAction
                  label={CONSOLE.doctorQueue}
                  variant="secondary"
                  data-testid="doctor-queue-toggle"
                  onClick={() => setQueueOpen(true)}
                />
              }
              open={queueOpen}
              onOpenChange={setQueueOpen}
              title={t('doctorQueue', locale)}
              description={t('doctorQueueReadOnly', locale)}
            >
              {queueContents}
              <ConsoleAction
                label={CONSOLE.foundationClose}
                variant="secondary"
                onClick={() => setQueueOpen(false)}
              />
            </Sheet>
          </div>
          {sessionHeader}
        </div>
        <div className="doc-shell">
          <aside className="doc-queue" aria-label={t('doctorQueue', locale)}>
            {queueOpen ? null : queueContents}
          </aside>
          <section className="doc-work" aria-label={t('visitNote', locale)}>
            <div
              className="doc-identity"
              data-testid="doctor-patient-identity"
              data-help-topic="identity"
            >
              {patient === null ? (
                <p>{t('nobodyToSee', locale)}</p>
              ) : (
                <>
                  <div className="doc-patient-serial">
                    <small>{t('colSerial', locale)}</small>
                    <strong>{formatNumber(patient.serial, numerals)}</strong>
                  </div>
                  <div className="doc-patient-main">
                    <h1>
                      {records?.patient.fullName ??
                        names.get(patient.patientId) ??
                        t('patientPanel', locale)}
                    </h1>
                    <p>
                      {records?.patient.ageYears == null
                        ? ''
                        : `${formatNumber(records.patient.ageYears, numerals)} ${t('years', locale)} · `}
                      {records?.patient.sex == null
                        ? ''
                        : t(
                            records.patient.sex === 'female'
                              ? 'sexFemale'
                              : records.patient.sex === 'male'
                                ? 'sexMale'
                                : 'sexOther',
                            locale,
                          )}
                      {records?.patient.bloodGroup == null
                        ? ''
                        : ` · ${t('bloodGroup', locale)} ${records.patient.bloodGroup}`}
                    </p>
                    <p
                      className={`doc-allergy${intake?.asked && intake.allergiesBn.length > 0 ? ' doc-allergy-known' : ''}`}
                    >
                      {t('allergies', locale)}: {allergy}
                    </p>
                  </div>
                  <div className="doc-save-status" data-testid="doctor-save-status">
                    {status}
                  </div>
                </>
              )}
            </div>
            <div className="doc-columns">
              <div className="doc-information">{information}</div>
              <div className="doc-record-column">
                <div className="doc-record-scroll">
                  {record}
                  {recovery}
                </div>
                <div className="doc-record-footer">{footer}</div>
              </div>
            </div>
          </section>
        </div>
      </ConsoleWorkspaceFrame>
    </div>
  );
}
