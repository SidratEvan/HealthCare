'use client';

/** Laboratory workbench (S-B-08, FR-LAB-01..04). Lifecycle rules remain in
 * shared/domain. Names stay behind a separate scoped online read (DB-P7).
 * Identifying reads are durably audited before the server returns them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  applyLocalLabChange,
  canActOnTestOrder,
  isOpenTestOrder,
  openForSeconds,
  sortLabQueue,
} from '@platform/domain';
import {
  format,
  formatClock,
  formatNumber,
  t,
  formatAge,
  numeralsFor,
  labTestName,
} from '@platform/i18n';
import {
  ConsoleHelp,
  ConsolePageHeader,
  ConsoleState,
  ConsoleConfirmation,
  Sheet,
  SheetClose,
  BilingualLabel,
  Card,
  Chip,
  FilterChip,
  FreshnessLine,
  ToastProvider,
  useToast,
  useLocale,
} from '@platform/ui';

import { ActionButton } from '@/components/ActionButton';
import { ConsoleWorkspaceFrame } from '@/components/ConsoleWorkspaceFrame';
import { DemoBanner } from '@/components/DemoBanner';
import { OfflineBlock } from '@/components/OfflineBlock';
import { matchingLabOrders } from '@/lib/clinicalWorkspace';
import { CLINICAL } from '@/lib/clinicalWorkspaceMessages';
import { readDemoSession } from '@/lib/demo';
import { failureOf, labApi, readReportFile } from '@/lib/lab';
import '@platform/ui/console-lab.css';

/** The demo principal (CLAUDE.md §4.1). Existing authenticated session supplies this token. */
function readToken() {
  return readDemoSession()?.token ?? null;
}

/** Each state, in the words `APP_FLOW.md` B5 gives it. */
const STATE_LABEL = {
  ordered: 'labStateOrdered',
  sample_collected: 'labStateSampleCollected',
  processing: 'labStateProcessing',
  report_ready: 'labStateReportReady',
  delivered: 'labStateDelivered',
  cancelled: 'labStateCancelled',
};

/** The button that moves an order on from each state. */
const NEXT_ACTION = {
  ordered: { action: 'collect', key: 'labCollect' },
  sample_collected: { action: 'process', key: 'labProcess' },
};

export function LabConsole() {
  return (
    <ToastProvider placement="console">
      <LabBody />
    </ToastProvider>
  );
}

function LabBody() {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const { show } = useToast();
  const session = readDemoSession();
  const hospitalId = session?.hospitalId ?? '';

  const api = useMemo(() => labApi(readToken), []);

  const [queue, setQueue] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState('open');
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('all');
  const [now, setNow] = useState(() => new Date());
  const [online, setOnline] = useState(true);
  const [busyId, setBusyId] = useState(null);
  /** Names fetched on request, never with the queue (`DB-P7`). */
  const [names, setNames] = useState(new Map());
  const loadSequence = useRef(0);
  const writing = useRef(false);

  const load = useCallback(async () => {
    if (hospitalId === '') return;
    const sequence = ++loadSequence.current;
    setFailed(false);
    try {
      const result = await api.queue(hospitalId, filter);
      if (sequence !== loadSequence.current) return;
      setQueue(result);
      setOrders(sortLabQueue(result.orders));
    } catch {
      if (sequence === loadSequence.current) setFailed(true);
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [api, hospitalId, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  // The freshness line and every waiting clock age on screen with nothing
  // else happening — that is what they are for (`FR-OFF-03`).
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const sync = () => {
      setOnline(globalThis.navigator.onLine);
    };
    sync();
    globalThis.addEventListener('online', sync);
    globalThis.addEventListener('offline', sync);
    return () => {
      globalThis.removeEventListener('online', sync);
      globalThis.removeEventListener('offline', sync);
    };
  }, []);

  /** Applies a state button: optimistic first, then the server's own row. */
  const advance = useCallback(
    async (order, action) => {
      if (writing.current || !online) return;
      const guard = canActOnTestOrder(order, action);
      if (!guard.ok) {
        show({ title: guard.detail, tone: 'caution' });
        return;
      }

      writing.current = true;
      ++loadSequence.current;
      const at = new Date().toISOString();
      // The state machine from `shared/domain`, not a copy of it: whatever the
      // server decides, the screen has already decided the same way.
      setOrders((current) =>
        sortLabQueue(
          current.map((entry) =>
            entry.id === order.id
              ? applyLocalLabChange(entry, { orderId: order.id, action, at })
              : entry,
          ),
        ),
      );

      setBusyId(order.id);
      try {
        const result = await api.advance(order.id, action);
        setOrders((current) =>
          sortLabQueue(current.map((entry) => (entry.id === order.id ? result.order : entry))),
        );
      } catch (error) {
        // Roll the row back to what the server last said, and say why.
        await load();
        const failure = failureOf(error);
        show({
          title: failure.kind === 'offline' ? t('offline', locale) : failure.message,
          tone: 'caution',
        });
      } finally {
        writing.current = false;
        setBusyId(null);
      }
    },
    [api, load, show, locale, online],
  );

  /** File/key kept for retry; uncertain delivery is read back (FR-LAB-03). */
  const upload = useCallback(
    async (order, file, attemptId) => {
      if (writing.current || !online) return false;
      writing.current = true;
      ++loadSequence.current;
      try {
        const read = await readReportFile(file);
        if (!read.ok) {
          show({
            title:
              read.reason === 'empty'
                ? CLINICAL.fileEmpty[locale]
                : t(read.reason === 'size' ? 'labFileTooBig' : 'labFileWrongType', locale),
            tone: 'caution',
          });
          return false;
        }
        if (!online) return false;
        setBusyId(order.id);
        try {
          const result = await api.upload(
            order.id,
            { type: read.type, base64: read.base64 },
            attemptId,
          );
          setOrders((current) =>
            sortLabQueue(current.map((entry) => (entry.id === order.id ? result.order : entry))),
          );
          show({
            title: t(order.visitId === null ? 'labDeliveredToPatient' : 'labUploaded', locale),
            tone: 'positive',
          });
          return true;
        } catch (error) {
          const failure = failureOf(error);
          if (failure.kind === 'offline') {
            show({ title: CLINICAL.uploadUncertain[locale], tone: 'caution' });
            // FR-LAB-03: a report on the order is not proof it is *this* file —
            // another bench may have uploaded one. Only the same key can say,
            // so the same attempt is replayed: the server answers its own
            // commit as a duplicate, and refuses if a different report is there.
            try {
              const result = await api.upload(
                order.id,
                { type: read.type, base64: read.base64 },
                attemptId,
              );
              setOrders((current) =>
                sortLabQueue(
                  current.map((entry) => (entry.id === order.id ? result.order : entry)),
                ),
              );
              show({
                title: t(
                  result.order.visitId === null ? 'labDeliveredToPatient' : 'labDeliveredTo',
                  locale,
                ),
                tone: 'positive',
              });
              return true;
            } catch (replayError) {
              const replay = failureOf(replayError);
              if (replay.kind === 'refused' && replay.code === 'TEST_TRANSITION_INVALID') {
                show({ title: CLINICAL.uploadOtherReport[locale], tone: 'caution' });
                void load();
              }
              /* Otherwise keep same file/key. A lost reply is not a failed commit. */
            }
          } else show({ title: t('labUploadFailed', locale), tone: 'caution' });
          return false;
        } finally {
          setBusyId(null);
        }
      } finally {
        writing.current = false;
      }
    },
    [api, load, show, locale, online],
  );

  const reveal = useCallback(
    async (orderId) => {
      if (!online) return;
      try {
        const label = await api.patientLabel(orderId);
        setNames((current) => new Map(current).set(orderId, label ?? '—'));
      } catch {
        show({ title: t('loadFailed', locale), tone: 'caution' });
      }
    },
    [api, show, locale, online],
  );

  const freshness = {
    justNow: t('updatedJustNow', locale),
    ago: t('updatedAgo', locale),
    never: t('neverConfirmed', locale),
    stale: t('staleWarning', locale),
  };
  const minutes = (value) => formatAge(value, locale, numerals);

  if (session === null || hospitalId === '') return <Notice>{t('noSession', locale)}</Notice>;
  const openCount = orders.filter((order) => isOpenTestOrder(order.state)).length;
  const visible = matchingLabOrders(orders, search, stage);
  return (
    <ConsoleWorkspaceFrame
      session={session}
      workspace={CLINICAL.lab}
      rail="navTests"
      navigation={[
        {
          id: 'lab',
          label: { bn: t('navTests', 'bn'), en: t('navTests', 'en') },
          current: true,
          roles: ['lab', 'hospital_admin'],
          enabled: true,
          onSelect: () => {
            setStage('all');
            setSearch('');
          },
        },
        {
          id: 'switch',
          label: CLINICAL.switchConsole,
          roles: [session.role],
          enabled: true,
          onSelect: () => globalThis.location.assign('/'),
        },
      ]}
      actions={
        <>
          <span className={`cf-status cf-tone-${online ? 'positive' : 'caution'}`}>
            {t(online ? 'online' : 'offline', locale)}
          </span>
          <ConsoleHelp
            topic={{
              id: 'lab',
              title: CLINICAL.lab,
              steps: [CLINICAL.labHelp, CLINICAL.uploadReview, CLINICAL.fileHint],
            }}
          />
        </>
      }
    >
      <div className="lab-workspace" data-testid="lab-console">
        <DemoBanner />
        <ConsolePageHeader
          title={CLINICAL.lab}
          description={CLINICAL.labIntro}
          actions={
            queue === null ? undefined : (
              <FreshnessLine
                asOf={new Date(queue.serverTs)}
                now={now}
                labels={freshness}
                formatMinutes={minutes}
              />
            )
          }
        />
        <OfflineBlock
          connected={online}
          pendingCount={0}
          lastServerTs={queue?.serverTs ?? null}
          stuckCount={0}
          locale={locale}
          now={now}
        />
        {loading ? (
          <div data-testid="lab-loading">
            <ConsoleState kind="loading" description={CLINICAL.labIntro} />
          </div>
        ) : failed || queue === null ? (
          <div data-testid="lab-failed">
            <ConsoleState
              kind="error"
              description={CLINICAL.labIntro}
              onRetry={() => {
                void load();
              }}
            />
          </div>
        ) : (
          <>
            <div className="lab-toolbar">
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label={t('labTitle', locale)}
                data-testid="lab-filters"
              >
                {['open', 'reported', 'all'].map((value) => (
                  <FilterChip
                    key={value}
                    selected={filter === value}
                    onToggle={() => {
                      setFilter(value);
                      setStage('all');
                    }}
                  >
                    {t(
                      value === 'open'
                        ? 'labQueueOpen'
                        : value === 'reported'
                          ? 'labQueueReported'
                          : 'labQueueAll',
                      locale,
                    )}
                  </FilterChip>
                ))}
              </div>
              <input
                className="lab-search"
                type="search"
                value={search}
                aria-label={CLINICAL.searchTests[locale]}
                placeholder={CLINICAL.searchTests[locale]}
                data-testid="lab-search"
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="lab-layout">
              <section>
                <div className="lab-stages">
                  {['ordered', 'sample_collected', 'processing'].map((value) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={stage === value}
                      onClick={() => setStage(stage === value ? 'all' : value)}
                      data-testid={`lab-stage-${value}`}
                    >
                      <strong>
                        {formatNumber(
                          orders.filter((order) => order.state === value).length,
                          numerals,
                        )}
                      </strong>
                      {t(STATE_LABEL[value], locale)}
                    </button>
                  ))}
                </div>
                <p className="text-body-sm text-ink-muted">
                  {format('labOpenCount', locale, { count: formatNumber(openCount, numerals) })}
                </p>
                {orders.length === 0 ? (
                  <Card data-testid="lab-empty">
                    <p>{t('labEmpty', locale)}</p>
                    <p>{t('labEmptyHint', locale)}</p>
                  </Card>
                ) : visible.length === 0 ? (
                  <Card data-testid="lab-no-matches">{CLINICAL.noMatches[locale]}</Card>
                ) : (
                  <ul className="lab-orders">
                    {visible.map((order) => (
                      <li key={order.id}>
                        <OrderRow
                          order={order}
                          now={now}
                          locale={locale}
                          busy={busyId !== null}
                          online={online}
                          name={names.get(order.id) ?? null}
                          onReveal={() => {
                            void reveal(order.id);
                          }}
                          onAdvance={(action) => {
                            void advance(order, action);
                          }}
                          onUpload={(file, key) => upload(order, file, key)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <aside className="lab-turnaround">
                <Turnaround rows={queue.turnaround} locale={locale} />
              </aside>
            </div>
          </>
        )}
      </div>
    </ConsoleWorkspaceFrame>
  );
}

/** One order on the bench. */
function OrderRow({ order, now, locale, busy, online, name, onReveal, onAdvance, onUpload }) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const next = NEXT_ACTION[order.state];
  const waiting = openForSeconds(order, now.toISOString());
  const open = isOpenTestOrder(order.state);

  // §5.1: a control that is off says why, rather than being dead.
  const offReason = !online ? t('offline', locale) : busy ? t('actionSending', locale) : null;

  return (
    <div className="lab-order" data-testid={`lab-order-${order.id}`}>
      <div className="min-w-0 flex-1">
        <p className="font-reading text-title-sm text-ink">
          {labTestName(order.testCode, locale, order.testName)}
        </p>
        <p className="lab-reference">
          {CLINICAL.reference[locale]}
          {' \u00b7 '}
          {order.id}
          {' \u00b7 '}
          {(order.visitId === null ? CLINICAL.noDoctor : CLINICAL.byDoctor)[locale]}
        </p>
        <p className="mt-1 text-body-sm text-ink-muted">
          {format('labOrderedAt', locale, { time: clock(order.orderedAt, locale) })}
          {waiting === null
            ? ''
            : ` · ${format('labWaitingFor', locale, { duration: duration(waiting, locale) })}`}
        </p>

        {/* `DB-P7`: the name is a separate scoped read. */}
        <p className="lab-name text-body-sm text-ink-secondary">
          {name !== null && <span data-testid={`lab-patient-${order.id}`}>{name}</span>}
          {name === null && (
            <button
              type="button"
              className="min-h-touch underline"
              disabled={offReason !== null}
              title={offReason ?? undefined}
              onClick={onReveal}
              data-testid={`lab-reveal-${order.id}`}
            >
              {t('labShowPatient', locale)}
            </button>
          )}
        </p>
      </div>

      <div className="lab-order-actions">
        <Chip tone={open ? 'caution' : order.state === 'cancelled' ? 'neutral' : 'positive'}>
          {t(STATE_LABEL[order.state], locale)}
        </Chip>

        {next !== undefined ? (
          <ActionButton
            size="sm"
            variant="primary"
            reason={offReason}
            onClick={() => {
              onAdvance(next.action);
            }}
            testId={`lab-${next.action}-${order.id}`}
          >
            {t(next.key, locale)}
          </ActionButton>
        ) : null}

        {order.state === 'processing' ? (
          <UploadReview
            order={order}
            locale={locale}
            reason={offReason}
            name={name}
            onReveal={onReveal}
            onSubmit={onUpload}
          />
        ) : null}

        {open ? (
          <ConsoleConfirmation
            open={cancelOpen}
            onOpenChange={setCancelOpen}
            pending={busy}
            title={CLINICAL.cancelTitle}
            description={CLINICAL.cancelHint}
            confirmLabel={{ bn: t('labCancel', 'bn'), en: t('labCancel', 'en') }}
            trigger={
              <button
                type="button"
                disabled={offReason !== null}
                title={offReason ?? undefined}
                data-testid={`lab-cancel-${order.id}`}
              >
                {t('labCancel', locale)}
              </button>
            }
            onConfirm={() => {
              if (offReason !== null) return;
              setCancelOpen(false);
              onAdvance('cancel');
            }}
          />
        ) : null}

        {order.report !== null && order.report.deliveredToWalletAt !== null ? (
          <p className="text-caption text-ok-700">
            {t(order.visitId === null ? 'labDeliveredToPatient' : 'labDeliveredTo', locale)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The upload control.
 *
 * A label wrapping a hidden `<input type="file">` rather than a button that
 * clicks one: a screen reader announces the label, the keyboard reaches it,
 * and the browser's own picker is what opens (`A11Y` in FRONTEND.md §7).
 */
function UploadReview({ order, locale, reason, name, onReveal, onSubmit }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [attemptId, setAttemptId] = useState(null);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  return (
    <Sheet
      console
      variant="modal"
      open={open}
      onOpenChange={(value) => {
        if (sending) return;
        setOpen(value);
      }}
      title={CLINICAL.uploadTitle[locale]}
      description={CLINICAL.uploadReview[locale]}
      trigger={
        <button
          type="button"
          className="rounded-sm bg-brand-600 min-h-touch px-3 text-white"
          disabled={reason !== null}
          title={reason ?? undefined}
          data-testid={`lab-upload-${order.id}`}
        >
          <BilingualLabel label={{ bn: t('labUpload', 'bn'), en: t('labUpload', 'en') }} />
        </button>
      }
    >
      <ConsoleHelp
        topic={{
          id: 'lab-upload',
          title: CLINICAL.uploadTitle,
          steps: [CLINICAL.uploadReview, CLINICAL.labHelp],
        }}
      />
      <p>
        {CLINICAL.reference[locale]}
        {' \u00b7 '}
        {order.id}
      </p>
      <p className="font-semibold">{labTestName(order.testCode, locale, order.testName)}</p>
      <p>{name ?? t('labShowPatient', locale)}</p>
      {name === null ? (
        <button
          type="button"
          disabled={reason !== null}
          title={reason ?? undefined}
          onClick={onReveal}
        >
          {t('labShowPatient', locale)}
        </button>
      ) : null}
      <label className="lab-file">
        <span>{CLINICAL.chooseFile[locale]}</span>
        <input
          data-testid={`lab-report-file-${order.id}`}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          disabled={sending}
          onChange={(event) => {
            const chosen = event.currentTarget.files?.[0] ?? null;
            setFile(chosen);
            setAttemptId(chosen === null ? null : crypto.randomUUID());
            setError(null);
          }}
        />
        <span>{file?.name ?? CLINICAL.fileHint[locale]}</span>
      </label>
      {error === null ? null : (
        <p role="alert" className="text-warn-700">
          {error}
        </p>
      )}
      <div className="cf-confirm-actions">
        <SheetClose asChild>
          <button type="button" disabled={sending}>
            {CLINICAL.back[locale]}
          </button>
        </SheetClose>
        <ActionButton
          size="md"
          variant="primary"
          reason={reason ?? (file === null ? CLINICAL.chooseFile[locale] : null)}
          testId={`lab-report-submit-${order.id}`}
          onClick={() => {
            if (sending || reason !== null || file === null || attemptId === null) return;
            setSending(true);
            void onSubmit(file, attemptId)
              .then((ok) => {
                if (ok) {
                  setOpen(false);
                  setFile(null);
                  setAttemptId(null);
                  setError(null);
                } else setError(CLINICAL.retryUpload[locale]);
              })
              .catch(() => setError(CLINICAL.retryUpload[locale]))
              .finally(() => setSending(false));
          }}
        >
          {CLINICAL.uploadTitle[locale]}
        </ActionButton>
      </div>
    </Sheet>
  );
}

/** `FR-LAB-04`, measured and never claimed. */
function Turnaround({ rows, locale }) {
  const numerals = numeralsFor(locale);
  return (
    <section aria-labelledby="turnaround-heading" data-testid="lab-turnaround">
      <h2 id="turnaround-heading" className="font-reading text-title-sm text-ink">
        {t('labTurnaroundTitle', locale)}
      </h2>
      <p className="mt-1 text-body-sm text-ink-muted">{t('labTurnaroundHint', locale)}</p>

      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.testCode} className="rounded-sm border border-line p-3">
            <p className="text-body-md text-ink">
              {labTestName(row.testCode, locale, row.testName)}
            </p>
            <p className="text-body-sm text-ink-secondary">
              {row.medianSeconds === null
                ? t('labTurnaroundNone', locale)
                : format('labTurnaroundMedian', locale, {
                    duration: duration(row.medianSeconds, locale),
                  })}
            </p>
            {row.open > 0 ? (
              <p className="text-caption text-ink-muted">
                {format('labTurnaroundOpen', locale, {
                  count: formatNumber(row.open, numerals),
                })}
                {row.oldestOpenSeconds === null
                  ? ''
                  : ` · ${format('labOldestOpen', locale, {
                      duration: duration(row.oldestOpenSeconds, locale),
                    })}`}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Notice({ children }) {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-body-lg text-ink-secondary">{children}</p>
    </div>
  );
}

/**
 * A Dhaka wall clock, in the numerals the locale asks for (`TYP-04`).
 *
 * `formatClock`, not `toLocaleTimeString('bn-BD')`: the browser's Bangla
 * clock is Bengali digits with a Latin "PM" stuck on the end, the
 * half-translated form `I18N-05` rules out.
 */
function clock(at, locale) {
  return formatClock(at, numeralsFor(locale));
}

/** Seconds as a person says them: minutes under an hour, hours above. */
function duration(seconds, locale) {
  const numerals = numeralsFor(locale);
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) {
    return `${formatNumber(mins, numerals)} ${t('minutesShort', locale)}`;
  }
  const hours = Math.round(mins / 6) / 10;
  return `${formatNumber(hours, numerals)} ${t('hoursShort', locale)}`;
}
