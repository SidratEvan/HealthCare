'use client';

/** Four-step authorised Registration desk (S-B-03, FR-REC-14/20/32).
 * A patient profile and an issued queue serial are separate server receipts.
 * Keep the original attempt during uncertain outcomes; never predict a serial.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { deskChambers } from '@platform/client';
import {
  CONSOLE,
  format,
  formatClock,
  formatNumber,
  formatSerial,
  localName,
  numeralsFor,
  t,
} from '@platform/i18n';
import {
  BilingualLabel,
  ConsoleAction,
  ConsoleConfirmation,
  ConsoleHelp,
  ConsolePageHeader,
  ConsoleState,
  ConsoleStatus,
  FreshnessLine,
  ToastProvider,
  useLocale,
} from '@platform/ui';

import { ConsoleWorkspaceFrame } from '@/components/ConsoleWorkspaceFrame';
import { DemoBanner } from '@/components/DemoBanner';
import { FAILURE_KEY, PatientFinder } from '@/components/PatientFinder';
import { useStaffWorkspace } from '@/components/StaffEntry';
import { readDemoSession } from '@/lib/demo';
import { addWalkIn } from '@/lib/registration';
import { fetchStaffChambers } from '@/lib/staffAuth';
import '@platform/ui/console-registration.css';

const STEPS = ['regStepPhone', 'regStepPatient', 'regStepDoctor', 'regStepSerial'];
const STATUS = {
  scheduled: 'sessionScheduled',
  running: 'sessionRunning',
  paused: 'regPaused',
  ended: 'chamberEnded',
  cancelled: 'receptionChamberCancelled',
};
const closed = (chamber) => chamber.status === 'ended' || chamber.status === 'cancelled';

export function RegistrationConsole() {
  return (
    <ToastProvider placement="console">
      <RegistrationBody />
    </ToastProvider>
  );
}
function RegistrationBody() {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const session = readDemoSession();
  const context = useStaffWorkspace();
  const [from, setFrom] = useState(null);
  const [selected, setSelected] = useState(null);
  const [online, setOnline] = useState(true);
  const [chambers, setChambers] = useState([]);
  const [load, setLoad] = useState('loading');
  const [readAt, setReadAt] = useState(null);
  const [now, setNow] = useState(() => new Date());
  const [patient, setPatient] = useState(null);
  const [phoneReady, setPhoneReady] = useState(false);
  const [round, setRound] = useState(0);
  const [finderDirty, setFinderDirty] = useState(false);
  const [finderUnresolved, setFinderUnresolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState(null);
  const [issued, setIssued] = useState(null);
  const [destination, setDestination] = useState(null);
  const sending = useRef(false);
  const original = useRef(null);
  const allowExit = useRef(false);
  const restoreFocus = useRef(null);
  const readVersion = useRef(0);
  const dirty = issued === null && (finderDirty || patient !== null);
  const locked = busy || uncertain || finderUnresolved;
  const queueUrl = (id) => `/?session=${encodeURIComponent(id)}`;
  const reset = () => {
    setSelected(from);
    setPatient(null);
    setIssued(null);
    setRound((old) => old + 1);
    setFinderDirty(false);
    setFinderUnresolved(false);
    setPhoneReady(false);
    setError(null);
    setUncertain(false);
    original.current = null;
  };
  const navigate = (target) => {
    if (locked) {
      setError('regUncertain');
      return;
    }
    if (dirty) {
      restoreFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setDestination(target);
    } else if (target === 'reset') reset();
    else {
      allowExit.current = true;
      globalThis.location.assign(target);
    }
  };
  useEffect(() => {
    const id = new URLSearchParams(globalThis.location.search).get('from');
    setFrom(id);
    setSelected(id);
    setOnline(globalThis.navigator.onLine);
  }, []);
  const loadChambers = useCallback(async () => {
    const version = ++readVersion.current;
    if (!globalThis.navigator.onLine) return;
    const answer = await fetchStaffChambers(true);
    if (version !== readVersion.current) return;
    if (answer === null) {
      setLoad('failed');
      return;
    }
    setChambers(
      context === null
        ? answer
        : deskChambers(
            answer,
            context.desks,
            context.profile.staff.id,
            readDemoSession()?.receptionDeskId ?? null,
          ),
    );
    setLoad('ready');
    setReadAt(new Date());
  }, [context]);
  useEffect(() => {
    void loadChambers();
    const up = () => {
      setOnline(true);
      void loadChambers();
    };
    const down = () => setOnline(false);
    const timer = globalThis.setInterval(() => {
      setNow(new Date());
      void loadChambers();
    }, 30_000);
    globalThis.addEventListener('online', up);
    globalThis.addEventListener('offline', down);
    return () => {
      readVersion.current += 1;
      globalThis.clearInterval(timer);
      globalThis.removeEventListener('online', up);
      globalThis.removeEventListener('offline', down);
    };
  }, [loadChambers]);
  useEffect(() => {
    const before = (event) => {
      if (dirty && !allowExit.current) {
        event.preventDefault();
      }
    };
    const link = (event) => {
      const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (
        !dirty ||
        allowExit.current ||
        target === null ||
        target.target === '_blank' ||
        target.hasAttribute('download') ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      event.preventDefault();
      if (locked) setError('regUncertain');
      else {
        restoreFocus.current = target;
        setDestination(target.href);
      }
    };
    globalThis.addEventListener('beforeunload', before);
    document.addEventListener('click', link, true);
    return () => {
      globalThis.removeEventListener('beforeunload', before);
      document.removeEventListener('click', link, true);
    };
  }, [dirty, locked]);
  const onFinderDirty = useCallback((value, pending) => {
    setFinderDirty(value);
    setFinderUnresolved(pending);
  }, []);
  const chamber = chambers.find((entry) => entry.id === selected) ?? null;
  const invalidFrom =
    from !== null && load === 'ready' && !chambers.some((entry) => entry.id === from);
  async function submit() {
    if (sending.current || !online || finderUnresolved) return;
    if (
      !uncertain &&
      (patient === null || chamber === null || closed(chamber) || invalidFrom || load !== 'ready')
    )
      return;
    if (!uncertain) {
      if (patient === null || chamber === null) return;
      if (
        original.current?.patient.patientId !== patient.patientId ||
        original.current.chamber.id !== chamber.id
      )
        original.current = {
          key: crypto.randomUUID(),
          at: new Date().toISOString(),
          patient,
          chamber,
        };
    }
    const saved = original.current;
    if (saved === null) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    const result = await addWalkIn(
      saved.chamber.id,
      saved.patient.patientId,
      { kind: 'end' },
      saved,
    );
    sending.current = false;
    setBusy(false);
    if (!result.ok) {
      setError(FAILURE_KEY[result.failure]);
      setUncertain(uncertain || result.failure === 'uncertain');
      void loadChambers();
      return;
    }
    setUncertain(false);
    setIssued({ serial: result.value, patient: saved.patient, chamber: saved.chamber });
  }
  if (session === null) return null;
  const step = issued !== null ? 4 : patient !== null ? 3 : phoneReady ? 2 : 1;
  const selectedDesk = context?.desks.find((desk) => desk.id === session.receptionDeskId);
  const back = issued?.chamber.id ?? from ?? selected;
  const reason = !online
    ? 'walkInOffline'
    : invalidFrom
      ? 'regUnavailableContext'
      : patient === null
        ? 'registrationChooseFirst'
        : chamber === null
          ? 'regSelectDoctor'
          : closed(chamber)
            ? 'regClosed'
            : load !== 'ready'
              ? 'registrationChambersFailed'
              : null;
  return (
    <ConsoleWorkspaceFrame
      session={session}
      workspace={CONSOLE.registrationTitle}
      rail="navRegistration"
      navigation={[
        {
          id: 'queue',
          label: CONSOLE.navQueue,
          roles: ['receptionist'],
          enabled: true,
          onSelect: () => navigate('/?view=reception'),
        },
        {
          id: 'registration',
          label: CONSOLE.receptionRegister,
          roles: ['receptionist'],
          enabled: true,
          current: true,
          onSelect: () => globalThis.scrollTo(0, 0),
        },
      ]}
      actions={
        <>
          <ConsoleHelp
            topic={{
              id: `registration-${step}`,
              title: CONSOLE.registrationTitle,
              steps: [
                CONSOLE[
                  ['regHelpPhone', 'regHelpPatient', 'regHelpDoctor', 'regHelpSerial'][step - 1] ??
                    'regHelpPhone'
                ],
                CONSOLE.regHelpNetwork,
              ],
            }}
          />
          <a className="cf-work-switch" href="/">
            {t('changeConsole', locale)}
          </a>
        </>
      }
    >
      <DemoBanner />
      <div className="cf-registration cf-stack" data-testid="registration-console">
        <ConsolePageHeader
          title={CONSOLE.registrationTitle}
          description={CONSOLE.registrationIntro}
          actions={
            <ConsoleAction
              label={CONSOLE.regStartOver}
              variant="secondary"
              data-testid="registration-start-over"
              onClick={() => navigate('reset')}
              {...(locked ? { disabled: true, disabledReason: t('regUncertain', locale) } : {})}
            />
          }
        />
        <ol className="cf-reg-steps" aria-label={t('registrationTitle', locale)}>
          {STEPS.map((key, index) => (
            <li key={key} {...(step === index + 1 ? { 'aria-current': 'step' } : {})}>
              {formatNumber(index + 1, numerals)} · <BilingualLabel label={CONSOLE[key]} />
            </li>
          ))}
        </ol>
        {!online ? (
          <p
            className="cf-feedback cf-tone-caution"
            role="status"
            data-testid="registration-offline"
          >
            {t('walkInOffline', locale)} {t('regPreserved', locale)}
          </p>
        ) : null}
        {error === null ? null : (
          <p className="cf-feedback cf-tone-alert" role="alert" data-testid="registration-error">
            {t(error, locale)}
          </p>
        )}
        {issued !== null ? (
          <section
            className="cf-reg-panel cf-reg-confirmed cf-stack"
            data-testid="registration-confirmed"
          >
            <ConsoleStatus tone="positive" label={CONSOLE.regSerialIssued} />
            <h2>{issued.patient.fullName}</h2>
            <p>
              {localName(locale, issued.chamber.doctorNameBn, issued.chamber.doctorNameEn)} ·{' '}
              {issued.chamber.room ?? '—'}
            </p>
            <div className="cf-reg-serial">
              <p>{t('regStepSerial', locale)}</p>
              <strong data-testid="registration-serial">
                {formatSerial(issued.serial, numerals)}
              </strong>
            </div>
            <h3>{t('regTellSerial', locale)}</h3>
            <p>{issued.patient.phone}</p>
            <div className="cf-reg-actions">
              <ConsoleAction
                label={CONSOLE.regNextPatient}
                data-testid="registration-next-patient"
                onClick={reset}
              />
              <ConsoleAction
                label={CONSOLE.regBackQueue}
                variant="secondary"
                data-testid="registration-return-queue"
                onClick={() => navigate(queueUrl(issued.chamber.id))}
              />
            </div>
          </section>
        ) : (
          <>
            {from === null ? null : (
              <div
                className="cf-feedback cf-tone-information"
                data-testid="registration-from-queue"
              >
                <p>{t(invalidFrom ? 'regUnavailableContext' : 'regFromQueue', locale)}</p>
                <ConsoleAction
                  label={CONSOLE.regBackQueue}
                  variant="secondary"
                  onClick={() => navigate(queueUrl(from))}
                />
              </div>
            )}
            <div className="cf-reg-grid">
              <div>
                <div hidden={patient !== null}>
                  <PatientFinder
                    key={round}
                    online={online}
                    onChosen={setPatient}
                    onDirty={onFinderDirty}
                    onProgress={setPhoneReady}
                  />
                </div>
                {patient === null ? null : (
                  <section className="cf-reg-panel cf-stack" data-testid="registration-chosen">
                    <h2>
                      <span className="cf-reg-number">2</span>
                      {t('regStepPatient', locale)}
                    </h2>
                    <div className="cf-reg-selected">
                      <strong>{patient.fullName}</strong>
                      <p>
                        {patient.ageYears === null
                          ? '—'
                          : format('counterAgeYears', locale, {
                              age: formatNumber(patient.ageYears, numerals),
                            })}{' '}
                        ·{' '}
                        {t(
                          { male: 'sexMale', female: 'sexFemale', other: 'sexOther' }[patient.sex],
                          locale,
                        )}{' '}
                        · {patient.phone}
                      </p>
                      <ConsoleStatus
                        tone="positive"
                        label={CONSOLE[patient.origin === 'new' ? 'regNew' : 'regExisting']}
                      />
                    </div>
                    <p className="cf-secondary">{t('regCreatedNoSerial', locale)}</p>
                    <ConsoleAction
                      label={CONSOLE.counterChangePatient}
                      variant="secondary"
                      onClick={() => {
                        setPatient(null);
                        original.current = null;
                      }}
                      {...(locked
                        ? { disabled: true, disabledReason: t('regUncertain', locale) }
                        : {})}
                    />
                  </section>
                )}
              </div>
              <section className="cf-reg-panel cf-stack" data-testid="registration-chambers">
                <h2>
                  <span className="cf-reg-number">3</span>
                  {t('regStepDoctor', locale)}
                </h2>
                <p>
                  {selectedDesk === undefined
                    ? t('accessCommonDesk', locale)
                    : localName(locale, selectedDesk.nameBn, selectedDesk.nameEn)}
                </p>
                <div className="cf-reg-read-time">
                  <span className="cf-secondary">{t('regListRead', locale)}</span>
                  <FreshnessLine
                    asOf={readAt}
                    now={now}
                    labels={{
                      justNow: t('updatedJustNow', locale),
                      ago: t('updatedAgo', locale),
                      never: t('neverSynced', locale),
                      stale: t('staleWarning', locale),
                    }}
                    formatMinutes={(minutes) => formatNumber(minutes, numerals)}
                  />
                </div>
                {load === 'loading' ? (
                  <div data-testid="registration-chambers-loading">
                    <ConsoleState kind="loading" description={CONSOLE.accessLoading} />
                  </div>
                ) : load === 'failed' ? (
                  <ConsoleState
                    kind="error"
                    description={CONSOLE.registrationChambersFailed}
                    onRetry={() => void loadChambers()}
                  />
                ) : chambers.length === 0 ? (
                  <div data-testid="registration-no-chambers">
                    <ConsoleState kind="empty" description={CONSOLE.registrationNoChambers} />
                  </div>
                ) : (
                  (from === null ? chambers : chambers.filter((entry) => entry.id === from)).map(
                    (entry) => (
                      <div key={entry.id} data-testid={`registration-chamber-${entry.id}`}>
                        <button
                          type="button"
                          className="cf-reg-chamber"
                          data-testid={`registration-add-${entry.id}`}
                          aria-pressed={selected === entry.id}
                          disabled={closed(entry) || locked || !online}
                          onClick={() => setSelected(entry.id)}
                        >
                          <span>
                            <strong>
                              {localName(locale, entry.doctorNameBn, entry.doctorNameEn)}
                            </strong>
                            <small>
                              {localName(locale, entry.departmentNameBn, entry.departmentNameEn)} ·{' '}
                              {entry.room ?? '—'} · {formatClock(entry.plannedStart, numerals)}
                            </small>
                            <ConsoleStatus
                              tone={
                                closed(entry)
                                  ? 'neutral'
                                  : entry.status === 'paused'
                                    ? 'caution'
                                    : 'positive'
                              }
                              label={CONSOLE[STATUS[entry.status] ?? 'sessionScheduled']}
                            />
                          </span>
                          <span>
                            {format('registrationWaiting', locale, {
                              count: formatNumber(entry.waiting, numerals),
                            })}
                            <span aria-hidden="true">{selected === entry.id ? ' ✓' : ' ○'}</span>
                          </span>
                        </button>
                        {closed(entry) ? (
                          <p className="cf-secondary">{t('regClosed', locale)}</p>
                        ) : null}
                      </div>
                    ),
                  )
                )}
              </section>
            </div>
            <section
              className="cf-reg-summary"
              aria-label={t('regSummary', locale)}
              data-testid="registration-summary"
            >
              <div>
                <strong>
                  {patient?.fullName ?? t('registrationChooseFirst', locale)} →{' '}
                  {chamber === null
                    ? t('regSelectDoctor', locale)
                    : localName(locale, chamber.doctorNameBn, chamber.doctorNameEn)}
                </strong>
                <p>{t('regServerOnly', locale)}</p>
                {busy ? <p role="status">{t('regPending', locale)}</p> : null}
              </div>
              <ConsoleAction
                label={CONSOLE[uncertain ? 'regRetrySame' : 'regGiveSerial']}
                loading={busy}
                data-testid="registration-submit"
                onClick={() => void submit()}
                {...((!uncertain && reason !== null) || !online || finderUnresolved
                  ? { disabled: true, disabledReason: t(reason ?? 'regUncertain', locale) }
                  : {})}
              />
            </section>
          </>
        )}
        {back === null || issued !== null || from !== null ? null : (
          <ConsoleAction
            label={CONSOLE.regBackQueue}
            variant="secondary"
            onClick={() => navigate(queueUrl(back))}
          />
        )}
        <ConsoleConfirmation
          open={destination !== null}
          onOpenChange={(open) => {
            if (!open) {
              setDestination(null);
              globalThis.requestAnimationFrame(() => restoreFocus.current?.focus());
            }
          }}
          trigger={<button type="button" hidden aria-label={t('regLeaveTitle', locale)} />}
          title={CONSOLE.regLeaveTitle}
          description={CONSOLE.regLeaveBody}
          confirmLabel={CONSOLE.regDiscard}
          onConfirm={() => {
            const target = destination;
            setDestination(null);
            if (target === 'reset') reset();
            else if (target !== null) {
              allowExit.current = true;
              globalThis.location.assign(target);
            }
          }}
        />
      </div>
    </ConsoleWorkspaceFrame>
  );
}
