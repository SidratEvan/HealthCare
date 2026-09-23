'use client';

/**
 * The lab — `S-B-08` (`APP_FLOW.md` B5, `FR-LAB-01`…`04`).
 *
 * Laid out like the ward board and the ER so a hospital's staff learn one
 * shape: navigation rail and connection block on the left, the queue in the
 * middle, and a right column carrying the turnaround figures.
 *
 * ## The queue is sorted by how long somebody has been waiting
 *
 * Open orders first, oldest first, by `sortLabQueue` in `shared/domain` — the
 * same function the API sorts with, so a bench and a server never disagree
 * about what is most urgent. A turnaround clock is running on every open row
 * (`FR-LAB-04`), and the one that has been waiting longest is the one about
 * to embarrass the hospital.
 *
 * ## The patient's name is not on the row
 *
 * A queue lists the test, its state and its age. The name is one tap away and
 * that tap is a request the server records (`DB-P7`, `FR-SEC-03`) — the same
 * arrangement the ward board's bed panel has. A bench calling somebody to a
 * counter needs it; a screen left open on a shared desk does not.
 *
 * ## Uploading is delivering
 *
 * `FR-LAB-03`: a report "auto-delivers to the patient wallet and the ordering
 * doctor". There is no separate *send* button, because there is no separate
 * act — the file reaching the store, the order closing and the patient's app
 * getting it happen in one transaction, and the button says so.
 *
 * ## The four states (`GR-03`)
 *
 * Loading is the shape of the queue, not a spinner. An error says what failed
 * and offers the retry. An empty bench says nothing is waiting and where work
 * comes from — never an empty box. Offline keeps the queue on screen with its
 * freshness ageing honestly, and says the buttons need a connection rather
 * than failing on a tap.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  applyLocalLabChange,
  canActOnTestOrder,
  isOpenTestOrder,
  openForSeconds,
  sortLabQueue,
  type LabAction,
  type TestOrderView,
  type TestState,
  type Timestamp,
  type TurnaroundSummary,
} from '@platform/domain';
import { format, formatNumber, t, type ConsoleKey, type Locale } from '@platform/i18n';
import {
  Button,
  Card,
  Chip,
  FilterChip,
  FreshnessLine,
  ToastProvider,
  useToast,
} from '@platform/ui';

import { OfflineBlock } from '@/components/OfflineBlock';
import { readDemoSession } from '@/lib/demo';
import { failureOf, labApi, readReportFile, type LabQueueResponse } from '@/lib/lab';

const LOCALE: Locale = 'bn';
const NUMERALS = 'bengali' as const;

/** `APP_FLOW.md` B1.1's rail. Tests is this screen; the rest are elsewhere. */
const NAV_ITEMS = [
  'navQueue',
  'navRegistration',
  'navBeds',
  'navEmergency',
  'navTests',
  'navBilling',
  'navDashboard',
] as const;

/** The demo principal (CLAUDE.md §4.1). Supabase Auth replaces this one function. */
function readToken(): string | null {
  return readDemoSession()?.token ?? null;
}

/** Each state, in the words `APP_FLOW.md` B5 gives it. */
const STATE_LABEL: Readonly<Record<TestState, ConsoleKey>> = {
  ordered: 'labStateOrdered',
  sample_collected: 'labStateSampleCollected',
  processing: 'labStateProcessing',
  report_ready: 'labStateReportReady',
  delivered: 'labStateDelivered',
  cancelled: 'labStateCancelled',
};

/** The button that moves an order on from each state. */
const NEXT_ACTION: Partial<Record<TestState, { action: LabAction; key: ConsoleKey }>> = {
  ordered: { action: 'collect', key: 'labCollect' },
  sample_collected: { action: 'process', key: 'labProcess' },
};

export function LabConsole(): ReactNode {
  return (
    <ToastProvider placement="console">
      <LabBody />
    </ToastProvider>
  );
}

function LabBody(): ReactNode {
  const locale = LOCALE;
  const { show } = useToast();
  const session = readDemoSession();
  const hospitalId = session?.hospitalId ?? '';

  const api = useMemo(() => labApi(readToken), []);

  const [queue, setQueue] = useState<LabQueueResponse | null>(null);
  const [orders, setOrders] = useState<readonly TestOrderView[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<'open' | 'reported' | 'all'>('open');
  const [now, setNow] = useState(() => new Date());
  const [online, setOnline] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Names fetched on request, never with the queue (`DB-P7`). */
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());

  const load = useCallback(async (): Promise<void> => {
    if (hospitalId === '') return;
    setFailed(false);
    try {
      const result = await api.queue(hospitalId, filter);
      setQueue(result);
      setOrders(sortLabQueue(result.orders));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
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
    const sync = (): void => {
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
    async (order: TestOrderView, action: LabAction): Promise<void> => {
      const guard = canActOnTestOrder(order, action);
      if (!guard.ok) {
        show({ title: guard.detail, tone: 'caution' });
        return;
      }

      const at = new Date().toISOString() as Timestamp;
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
      } catch (error: unknown) {
        // Roll the row back to what the server last said, and say why.
        await load();
        const failure = failureOf(error);
        show({
          title: failure.kind === 'offline' ? t('offline', locale) : failure.message,
          tone: 'caution',
        });
      } finally {
        setBusyId(null);
      }
    },
    [api, load, show, locale],
  );

  /** `FR-LAB-03`. One act: stored, closed, delivered. */
  const upload = useCallback(
    async (order: TestOrderView, file: File): Promise<void> => {
      const read = await readReportFile(file);
      if (!read.ok) {
        show({
          title: t(read.reason === 'size' ? 'labFileTooBig' : 'labFileWrongType', locale),
          tone: 'caution',
        });
        return;
      }

      setBusyId(order.id);
      try {
        const result = await api.upload(order.id, { type: read.type, base64: read.base64 });
        setOrders((current) =>
          sortLabQueue(current.map((entry) => (entry.id === order.id ? result.order : entry))),
        );
        show({
          title: t(order.visitId === null ? 'labDeliveredToPatient' : 'labUploaded', locale),
          tone: 'positive',
        });
      } catch (error: unknown) {
        const failure = failureOf(error);
        show({
          title: failure.kind === 'offline' ? t('offline', locale) : t('labUploadFailed', locale),
          tone: 'caution',
        });
      } finally {
        setBusyId(null);
      }
    },
    [api, show, locale],
  );

  const reveal = useCallback(
    async (orderId: string): Promise<void> => {
      try {
        const label = await api.patientLabel(orderId);
        setNames((current) => new Map(current).set(orderId, label ?? '—'));
      } catch {
        show({ title: t('loadFailed', locale), tone: 'caution' });
      }
    },
    [api, show, locale],
  );

  const freshness = {
    justNow: t('updatedJustNow', locale),
    ago: t('updatedAgo', locale),
    never: t('neverConfirmed', locale),
    stale: t('staleWarning', locale),
  };
  const minutes = (value: number): string =>
    `${formatNumber(value, NUMERALS)} ${t('minutesShort', locale)}`;

  if (hospitalId === '') return <Notice>{t('noSession', locale)}</Notice>;

  if (loading) {
    // GR-03 loading: the shape of the queue.
    return (
      <div className="flex min-h-screen gap-6 p-6" aria-busy="true" data-testid="lab-loading">
        <div className="w-52 shrink-0 rounded-md bg-sunken" />
        <div className="flex flex-1 flex-col gap-3">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="h-20 rounded-md bg-sunken" />
          ))}
        </div>
      </div>
    );
  }

  if (failed || queue === null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p role="alert" className="text-body-lg text-ink-secondary" data-testid="lab-failed">
          {t('labLoadFailed', locale)}
        </p>
        <Button
          variant="secondary"
          onClick={() => {
            void load();
          }}
        >
          {t('retry', locale)}
        </Button>
      </div>
    );
  }

  const openCount = orders.filter((order) => isOpenTestOrder(order.state)).length;

  return (
    <div className="flex min-h-screen" data-testid="lab-console">
      {/* --- navigation rail ------------------------------------------------- */}
      <nav aria-label={t('navTests', locale)} className="w-52 shrink-0 border-r border-line p-4">
        <ul className="flex flex-col gap-1">
          {NAV_ITEMS.map((key) => (
            <li key={key}>
              <span
                aria-current={key === 'navTests' ? 'page' : undefined}
                className="flex min-h-touch items-center rounded-sm px-3 text-body-md aria-[current=page]:bg-brand-100 aria-[current=page]:font-semibold"
              >
                {t(key, locale)}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-6">
          <OfflineBlock
            connected={online}
            pendingCount={0}
            lastServerTs={queue.serverTs}
            stuckCount={0}
            locale={locale}
            now={now}
          />
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* FR-DEM-07: the demo says what it is, on screen, permanently. */}
        <p className="bg-warn-100 px-6 py-2 text-caption text-warn-700">
          {t('demoBanner', locale)}
        </p>

        <header className="flex items-center gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0 flex-1">
            <h1 className="font-reading text-title-lg text-ink">{t('labTitle', locale)}</h1>
            <p className="text-body-sm text-ink-muted">
              {format(t('labOpenCount', locale), { count: formatNumber(openCount, NUMERALS) })}
            </p>
          </div>
          <FreshnessLine
            asOf={new Date(queue.serverTs)}
            now={now}
            labels={freshness}
            formatMinutes={minutes}
          />
        </header>

        <div className="flex min-h-0 flex-1 gap-6 p-6">
          <main className="flex min-w-0 flex-1 flex-col gap-3">
            <div
              className="flex gap-2"
              role="group"
              aria-label={t('labTitle', locale)}
              data-testid="lab-filters"
            >
              {(['open', 'reported', 'all'] as const).map((value) => (
                <FilterChip
                  key={value}
                  selected={filter === value}
                  onToggle={() => {
                    setFilter(value);
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

            {orders.length === 0 ? (
              // GR-03 empty: what this means and where work comes from.
              <Card data-testid="lab-empty">
                <p className="text-body-lg text-ink">{t('labEmpty', locale)}</p>
                <p className="mt-1 text-body-sm text-ink-muted">{t('labEmptyHint', locale)}</p>
              </Card>
            ) : (
              <ul className="flex flex-col gap-3">
                {orders.map((order) => (
                  <li key={order.id}>
                    <OrderRow
                      order={order}
                      now={now}
                      locale={locale}
                      busy={busyId === order.id}
                      online={online}
                      name={names.get(order.id) ?? null}
                      onReveal={() => {
                        void reveal(order.id);
                      }}
                      onAdvance={(action) => {
                        void advance(order, action);
                      }}
                      onUpload={(file) => {
                        void upload(order, file);
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </main>

          <aside className="w-80 shrink-0">
            <Turnaround rows={queue.turnaround} locale={locale} />
          </aside>
        </div>
      </div>
    </div>
  );
}

/** One order on the bench. */
function OrderRow({
  order,
  now,
  locale,
  busy,
  online,
  name,
  onReveal,
  onAdvance,
  onUpload,
}: {
  readonly order: TestOrderView;
  readonly now: Date;
  readonly locale: Locale;
  readonly busy: boolean;
  readonly online: boolean;
  readonly name: string | null;
  readonly onReveal: () => void;
  readonly onAdvance: (action: LabAction) => void;
  readonly onUpload: (file: File) => void;
}): ReactNode {
  const next = NEXT_ACTION[order.state];
  const waiting = openForSeconds(order, now.toISOString() as Timestamp);
  const open = isOpenTestOrder(order.state);

  return (
    <Card data-testid={`lab-order-${order.id}`}>
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-reading text-title-sm text-ink">{order.testName}</p>
          <p className="mt-1 text-body-sm text-ink-muted">
            {format(t('labOrderedAt', locale), { time: clock(order.orderedAt, locale) })}
            {waiting === null
              ? ''
              : ` · ${format(t('labWaitingFor', locale), { duration: duration(waiting, locale) })}`}
          </p>

          {/* `DB-P7`: the name is a separate, recorded read. */}
          <p className="mt-2 text-body-sm text-ink-secondary">
            {name !== null && <span data-testid={`lab-patient-${order.id}`}>{name}</span>}
            {name === null && (
              <button
                type="button"
                className="min-h-touch underline"
                onClick={onReveal}
                data-testid={`lab-reveal-${order.id}`}
              >
                {t('labShowPatient', locale)}
              </button>
            )}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <Chip tone={open ? 'caution' : order.state === 'cancelled' ? 'neutral' : 'positive'}>
            {t(STATE_LABEL[order.state], locale)}
          </Chip>

          {next !== undefined ? (
            <Button
              size="sm"
              variant="primary"
              disabled={busy || !online}
              onClick={() => {
                onAdvance(next.action);
              }}
              data-testid={`lab-${next.action}-${order.id}`}
            >
              {t(next.key, locale)}
            </Button>
          ) : null}

          {order.state === 'processing' ? (
            <UploadButton
              orderId={order.id}
              locale={locale}
              disabled={busy || !online}
              onChoose={onUpload}
            />
          ) : null}

          {open ? (
            <Button
              size="sm"
              variant="quiet"
              disabled={busy || !online}
              onClick={() => {
                onAdvance('cancel');
              }}
              data-testid={`lab-cancel-${order.id}`}
            >
              {t('labCancel', locale)}
            </Button>
          ) : null}

          {order.report !== null && order.report.deliveredToWalletAt !== null ? (
            <p className="text-caption text-ok-700">
              {t(order.visitId === null ? 'labDeliveredToPatient' : 'labDeliveredTo', locale)}
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/**
 * The upload control.
 *
 * A label wrapping a hidden `<input type="file">` rather than a button that
 * clicks one: a screen reader announces the label, the keyboard reaches it,
 * and the browser's own picker is what opens (`A11Y` in FRONTEND.md §7).
 */
function UploadButton({
  orderId,
  locale,
  disabled,
  onChoose,
}: {
  readonly orderId: string;
  readonly locale: Locale;
  readonly disabled: boolean;
  readonly onChoose: (file: File) => void;
}): ReactNode {
  return (
    <label
      className="inline-flex min-h-touch cursor-pointer items-center rounded-sm bg-brand-600 px-3 text-body-sm font-semibold text-on-brand aria-disabled:opacity-50"
      aria-disabled={disabled}
      data-testid={`lab-upload-${orderId}`}
    >
      {t('labUpload', locale)}
      <input
        type="file"
        className="sr-only"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        disabled={disabled}
        onChange={(event) => {
          const input = event.currentTarget;
          const file = input.files?.[0];
          if (file !== undefined) onChoose(file);
          // Cleared so that choosing the same file twice fires again — a
          // bench re-uploading a corrected scan of the same name is common.
          input.value = '';
        }}
      />
    </label>
  );
}

/** `FR-LAB-04`, measured and never claimed. */
function Turnaround({
  rows,
  locale,
}: {
  readonly rows: readonly TurnaroundSummary[];
  readonly locale: Locale;
}): ReactNode {
  return (
    <section aria-labelledby="turnaround-heading" data-testid="lab-turnaround">
      <h2 id="turnaround-heading" className="font-reading text-title-sm text-ink">
        {t('labTurnaroundTitle', locale)}
      </h2>
      <p className="mt-1 text-body-sm text-ink-muted">{t('labTurnaroundHint', locale)}</p>

      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.testCode} className="rounded-sm border border-line p-3">
            <p className="text-body-md text-ink">{row.testName}</p>
            <p className="text-body-sm text-ink-secondary">
              {row.medianSeconds === null
                ? t('labTurnaroundNone', locale)
                : format(t('labTurnaroundMedian', locale), {
                    duration: duration(row.medianSeconds, locale),
                  })}
            </p>
            {row.open > 0 ? (
              <p className="text-caption text-ink-muted">
                {format(t('labTurnaroundOpen', locale), {
                  count: formatNumber(row.open, NUMERALS),
                })}
                {row.oldestOpenSeconds === null
                  ? ''
                  : ` · ${format(t('labOldestOpen', locale), {
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

function Notice({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-body-lg text-ink-secondary">{children}</p>
    </div>
  );
}

/** A Dhaka wall clock, in the numerals the locale asks for (`TYP-04`). */
function clock(at: string, locale: Locale): string {
  const formatted = new Date(at).toLocaleTimeString(locale === 'bn' ? 'bn-BD' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Dhaka',
  });
  return formatted;
}

/** Seconds as a person says them: minutes under an hour, hours above. */
function duration(seconds: number, locale: Locale): string {
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) {
    return `${formatNumber(mins, NUMERALS)} ${t('minutesShort', locale)}`;
  }
  const hours = Math.round(mins / 6) / 10;
  return `${formatNumber(hours, NUMERALS)} ${t('hoursShort', locale)}`;
}
