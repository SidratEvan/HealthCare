'use client';

/**
 * The hospital admin dashboard — `S-B-10` (`APP_FLOW.md` B6, `FR-ADM-01`…`10`).
 *
 * A date range across the top, the sections B6 lists behind a tab strip —
 * overview, trends, loss & recovery, revenue, staff, beds, referrals,
 * feedback — then the forecast (`FR-ADM-09`), and an export on every one.
 *
 * ## One request, not nine
 *
 * Every section is in memory when the screen opens, so switching tabs costs
 * nothing. This screen is read in front of somebody: a director asks "and
 * referrals?" and the answer should not be a spinner.
 *
 * ## The headline number is the one that can be measured
 *
 * `FR-ADM-01` asks for average wait. **Nothing in this product records a
 * patient arriving** — reception has no check-in action anywhere in `PRD.md`
 * §8 — so the corridor wait cannot be computed, and the screen says so rather
 * than showing a zero. Beside it is the figure that *is* measurable and that
 * the queue engine actually moves: how much later than their own slot people
 * were called. See migration 0020.
 *
 * ## Each section carries its own age
 *
 * The overview, the trend and the revenue totals come from `v_admin_daily`,
 * a snapshot rebuilt when a read finds it older than five minutes; the rest
 * is read live; referrals and feedback are as old as their newest row. One
 * stamp for the whole screen would be true of one of those and false of the
 * others, so every section renders its own `<FreshnessLine>` (`CLAUDE.md`
 * §5.8).
 *
 * ## Charts
 *
 * Recharts, as `FRONTEND.md` §9 names, restyled to §1's "single-hue ramp of
 * green plus neutral grey": every colour is a token variable, never a hex.
 * One series is brand green. The one chart with two series — money lost
 * against money won back — pairs brand green with `--line-strong`; the pair
 * separates cleanly for every kind of colour vision (ΔE 42 protan, 45
 * normal), and because the grey is faint against the card it always carries a
 * text legend, with the CSV export as its table view. Bars are one colour
 * whatever their rank: colour names the thing, length says how much.
 *
 * ## The four states (`GR-03`)
 *
 * Loading is the shape of the screen, not a spinner. An error says what failed
 * and offers the retry. Empty is per section and says what would fill it.
 * Offline keeps the last figures on screen with their ages ageing honestly,
 * and the export says it needs a connection rather than failing on a tap.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  BED_KIND_NAMES,
  bedKindName,
  format,
  formatNumber,
  formatTaka,
  t,
  type BedKindName,
  type ConsoleKey,
  type Locale,
  formatAge,
} from '@platform/i18n';
import { Button, Card, FilterChip, FreshnessLine } from '@platform/ui';

import {
  adminApi,
  downloadExport,
  failureOf,
  RANGES,
  type ComplaintCategory,
  type Dashboard,
  type ExportView,
  type ForecastSlot,
  type RangeDays,
  type RevenueSlice,
} from '@/lib/admin';
import { readDemoSession } from '@/lib/demo';

const LOCALE: Locale = 'bn';

/** Bangla digits, as on every surface (`TYP-04`, the owner's ruling of 2026-09-24). */
const NUMERALS = 'bengali' as const;

/** Thirty days: long enough that the trend shows the adoption marker. */
const DEFAULT_RANGE: RangeDays = 29;

// Every chart colour is a token (`FRONTEND.md` §1.1). SVG presentation
// attributes resolve `var()`, so Recharts' `fill`/`stroke` props take these
// as they are.
const SERIES = 'var(--brand-600)';
const SERIES_NEUTRAL = 'var(--line-strong)';
const SURFACE = 'var(--bg-surface)';
const GRID = 'var(--line-hairline)';
const AXIS_INK = 'var(--ink-muted)';
const LABEL_INK = 'var(--ink-secondary)';
const TICK = { fill: AXIS_INK, fontSize: 'var(--text-caption)' } as const;

const TOOLTIP = {
  contentStyle: {
    background: SURFACE,
    border: '1px solid var(--line-soft)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--ink-primary)',
    fontSize: 'var(--text-body-sm)',
  },
  labelStyle: { color: LABEL_INK },
  itemStyle: { color: 'var(--ink-primary)' },
} as const;

type Tab =
  'today' | 'trend' | 'loss' | 'revenue' | 'staff' | 'beds' | 'referrals' | 'feedback' | 'forecast';

const TABS: readonly { readonly id: Tab; readonly key: ConsoleKey }[] = [
  { id: 'today', key: 'adminTabToday' },
  { id: 'trend', key: 'adminTabTrends' },
  { id: 'loss', key: 'adminTabLoss' },
  { id: 'revenue', key: 'adminTabRevenue' },
  { id: 'staff', key: 'adminTabStaff' },
  { id: 'beds', key: 'adminTabBeds' },
  { id: 'referrals', key: 'adminTabReferrals' },
  { id: 'feedback', key: 'adminTabFeedback' },
  { id: 'forecast', key: 'adminTabForecast' },
];

/** Which export each tab downloads. Revenue exports the doctor breakdown. */
const EXPORT_FOR: Readonly<Record<Tab, ExportView>> = {
  today: 'today',
  trend: 'trend',
  loss: 'loss',
  revenue: 'revenue-doctor',
  staff: 'staff',
  beds: 'beds',
  referrals: 'referrals',
  feedback: 'feedback',
  forecast: 'forecast',
};

type LoadState = 'loading' | 'ready' | 'error' | 'offline';

export function AdminDashboard(): ReactNode {
  const [data, setData] = useState<Dashboard | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [pending, setPending] = useState(false);
  const [tab, setTab] = useState<Tab>('today');
  const [days, setDays] = useState<RangeDays>(DEFAULT_RANGE);
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // Only the newest request may land. Tapping 7 days then 90 days quickly
  // must not end with the 7-day figures under a selected "90 days" chip.
  const latest = useRef(0);

  const token = readDemoSession()?.token ?? '';

  const load = useCallback(
    async (range: RangeDays) => {
      const request = latest.current + 1;
      latest.current = request;
      setPending(true);

      try {
        const fresh = await adminApi.dashboard(token, range);
        if (request !== latest.current) return;
        setData(fresh);
        setState('ready');
      } catch (error: unknown) {
        if (request !== latest.current) return;
        // Whatever was on screen stays there. An aggregate that is twenty
        // minutes old and says so beats an error page a director can read
        // nothing from.
        setState(failureOf(error));
      } finally {
        if (request === latest.current) setPending(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void load(days);
  }, [load, days]);

  // The freshness lines have to age on screen with nothing else happening.
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 30_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const onExport = useCallback(async () => {
    setExporting(true);
    setExportFailed(false);
    try {
      await downloadExport(token, EXPORT_FOR[tab], days);
    } catch {
      setExportFailed(true);
    } finally {
      setExporting(false);
    }
  }, [token, tab, days]);

  if (data === null) {
    if (state === 'loading') return <DashboardSkeleton />;

    return (
      <Shell>
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-md bg-alert-100 p-4"
          data-testid={state === 'offline' ? 'admin-offline' : 'admin-error'}
        >
          <p className="text-body-md text-alert-700">
            {t(state === 'offline' ? 'adminOffline' : 'adminLoadFailed', LOCALE)}
          </p>
          <Button variant="secondary" onClick={() => void load(days)} data-testid="admin-retry">
            {t('retry', LOCALE)}
          </Button>
        </div>
      </Shell>
    );
  }

  const offline = state === 'offline';

  return (
    <Shell>
      {offline ? (
        <p
          role="status"
          className="rounded-sm bg-warn-100 px-3 py-2 text-body-sm text-warn-700"
          data-testid="admin-offline-banner"
        >
          {t('adminOfflineStale', LOCALE)}
        </p>
      ) : null}

      {state === 'error' ? (
        <p role="alert" className="rounded-sm bg-alert-100 px-3 py-2 text-body-sm text-alert-700">
          {t('adminLoadFailed', LOCALE)}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {RANGES.map((range) => (
          <FilterChip
            key={range.days}
            selected={days === range.days}
            onToggle={() => {
              setDays(range.days);
            }}
          >
            {t(range.key, LOCALE)}
          </FilterChip>
        ))}

        <span className="ml-auto flex flex-wrap items-center gap-2">
          {offline ? (
            <Button
              variant="secondary"
              disabled
              disabledReason={t('adminExportOffline', LOCALE)}
              data-testid="admin-export"
            >
              {t('adminExport', LOCALE)}
            </Button>
          ) : (
            <Button
              variant="secondary"
              loading={exporting}
              onClick={() => void onExport()}
              data-testid="admin-export"
            >
              {exporting ? t('adminExporting', LOCALE) : t('adminExport', LOCALE)}
            </Button>
          )}
          {/* `FR-ADM-10` says CSV/PDF. The PDF is the browser's own, from this
              page's print styles — so it carries exactly the figures and ages
              on screen, which a separately rendered one would eventually stop
              doing. */}
          <Button
            variant="secondary"
            onClick={() => {
              globalThis.print();
            }}
            data-testid="admin-print"
          >
            {t('adminPrint', LOCALE)}
          </Button>
        </span>
      </div>

      {exportFailed ? (
        <p role="alert" className="text-body-sm text-alert-700">
          {t('adminExportFailed', LOCALE)}
        </p>
      ) : null}

      <Tabs selected={tab} onSelect={setTab} />

      <div
        role="tabpanel"
        id={`admin-panel-${tab}`}
        aria-labelledby={`admin-tab-${tab}`}
        aria-busy={pending}
        className={pending ? 'opacity-60' : undefined}
      >
        {tab === 'today' ? <TodaySection data={data} now={now} /> : null}
        {tab === 'trend' ? <TrendSection data={data} now={now} /> : null}
        {tab === 'loss' ? <LossSection data={data} now={now} /> : null}
        {tab === 'revenue' ? <RevenueSection data={data} now={now} /> : null}
        {tab === 'staff' ? <StaffSection data={data} now={now} /> : null}
        {tab === 'beds' ? <BedsSection data={data} now={now} /> : null}
        {tab === 'referrals' ? <ReferralsSection data={data} now={now} /> : null}
        {tab === 'feedback' ? <FeedbackSection data={data} now={now} /> : null}
        {tab === 'forecast' ? <ForecastSection data={data} now={now} /> : null}
      </div>
    </Shell>
  );
}

/**
 * The section switcher, as a real tab list.
 *
 * Arrow keys move between tabs (the WAI-ARIA tabs pattern), so the whole
 * screen can be walked without a mouse — the console's rule for every screen
 * (`A11Y-05`).
 */
function Tabs({
  selected,
  onSelect,
}: {
  readonly selected: Tab;
  readonly onSelect: (tab: Tab) => void;
}): ReactNode {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();

    const index = TABS.findIndex((entry) => entry.id === selected);
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = TABS[(index + step + TABS.length) % TABS.length];
    if (next === undefined) return;

    onSelect(next.id);
    globalThis.document.getElementById(`admin-tab-${next.id}`)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={t('adminTitle', LOCALE)}
      onKeyDown={onKeyDown}
      className="flex flex-wrap gap-1 border-b border-line pb-2 print:hidden"
    >
      {TABS.map((entry) => {
        const active = entry.id === selected;
        return (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`admin-tab-${entry.id}`}
            aria-selected={active}
            aria-controls={`admin-panel-${entry.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => {
              onSelect(entry.id);
            }}
            data-testid={`admin-tab-${entry.id}`}
            className="flex min-h-touch items-center rounded-sm px-3 text-body-md text-ink-secondary hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 aria-selected:bg-brand-100 aria-selected:font-semibold aria-selected:text-ink"
          >
            {t(entry.key, LOCALE)}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview (FR-ADM-01)
// ---------------------------------------------------------------------------

function TodaySection({ data, now }: SectionProps): ReactNode {
  const today = data.today;

  return (
    <Section testId="admin-section-today" asOf={data.freshness.snapshotAt} now={now}>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label={t('adminSeen', LOCALE)} value={num(today.seen)} testId="admin-seen" />
        <Stat label={t('adminBooked', LOCALE)} value={num(today.booked)} />
        <Stat label={t('adminNoShows', LOCALE)} value={num(today.noShows)} />
        <Stat
          label={t('adminWalkinRatio', LOCALE)}
          value={`${num(today.walkin)} / ${num(today.bookedAhead)}`}
        />
      </div>

      {/* `FR-ADM-01`'s wait runs from check-in to the call (`FR-REC-18`). A
          period in which nobody was checked in has no wait, and says so
          rather than showing a zero — the most flattering lie this screen
          could tell. Beside a measured wait, whether the counter's word was
          kept: the figure a patient actually remembers. */}
      {today.waitsMeasured === 0 ? (
        <Card tone="warn" data-testid="admin-wait-notice">
          <p className="text-body-md text-warn-700">{t('adminWaitUnmeasured', LOCALE)}</p>
          <p className="mt-1 max-w-prose text-body-sm text-ink-secondary">
            {t('adminWaitUnmeasuredWhy', LOCALE)}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4" data-testid="admin-waits">
          <Stat
            label={t('adminAvgWait', LOCALE)}
            value={minutes(today.avgWaitMinutes)}
            testId="admin-avg-wait"
            note={format('adminWaitsMeasured', LOCALE, { count: num(today.waitsMeasured) })}
          />
          <Stat label={t('adminLongestWait', LOCALE)} value={minutes(today.longestWaitMinutes)} />
          <Stat
            label={t('adminQuotesKept', LOCALE)}
            value={percent(data.quotes.keptRate)}
            tone="brand"
            testId="admin-quotes-kept"
            note={
              data.quotes.quoted === 0
                ? null
                : format('adminQuotesKeptNote', LOCALE, {
                    kept: num(data.quotes.kept),
                    quoted: num(data.quotes.quoted),
                  })
            }
          />
          {/* Below zero means people were called before the time they were
              quoted, on average. That is no overrun, and is said as such
              rather than as a negative number of minutes late. */}
          <Stat
            label={t('adminQuoteOver', LOCALE)}
            value={
              data.quotes.avgOverMinutes !== null && data.quotes.avgOverMinutes < 0
                ? t('adminQuoteNoOverrun', LOCALE)
                : minutes(data.quotes.avgOverMinutes)
            }
            note={
              data.quotes.avgOverMinutes !== null && data.quotes.avgOverMinutes < 0
                ? format('adminQuoteEarlyBy', LOCALE, {
                    minutes: num(Math.round(-data.quotes.avgOverMinutes)),
                  })
                : null
            }
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label={t('adminOverrun', LOCALE)} value={minutes(today.avgOverrunMinutes)} />
        <Stat
          label={t('adminLongestOverrun', LOCALE)}
          value={minutes(today.longestOverrunMinutes)}
        />
        <Stat
          label={t('adminSessionsLate', LOCALE)}
          value={`${num(today.sessionsLate)} / ${num(today.sessionsTotal)}`}
        />
        <Stat
          label={t('adminSessionsNeverStarted', LOCALE)}
          value={num(today.sessionsNeverStarted)}
        />
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Trends (FR-ADM-02)
// ---------------------------------------------------------------------------

function TrendSection({ data, now }: SectionProps): ReactNode {
  // Every day of the range is on the axis, measured or not. The view only has
  // rows for days a chamber ran, and an axis built from those alone joins
  // Wednesday to Saturday as if Thursday and Friday had been measured — and
  // drops the adoption marker whenever onboarding fell on a day with no
  // chamber, because the marker names a category the axis does not have.
  const byDate = new Map(data.trend.map((point) => [point.date, point]));
  const points = everyDay(data.range.from, data.range.to).map((date) => ({
    label: shortDate(date),
    overrun: byDate.get(date)?.avgOverrunMinutes ?? null,
  }));

  const hasAny = points.some((point) => point.overrun !== null);

  return (
    <Section testId="admin-section-trend" asOf={data.freshness.snapshotAt} now={now}>
      {!hasAny ? (
        <Empty />
      ) : (
        <Card>
          <h2 className="text-title-sm">{t('adminTrendCaption', LOCALE)}</h2>
          <div className="mt-3 h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 16, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={false} />
                <YAxis
                  tick={TICK}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  tickFormatter={(value: number) => num(value)}
                />
                <Tooltip
                  {...TOOLTIP}
                  cursor={{ stroke: SERIES_NEUTRAL }}
                  formatter={(value) => [minutes(asNumber(value)), t('adminOverrun', LOCALE)]}
                />

                {/* `FR-ADM-02`: "with the live-queue adoption date marked". The
                    marker is the point of the chart — it answers whether any
                    of this changed anything. Absent, not guessed, for a
                    facility with no recorded onboarding. */}
                {data.adoptionDate === null ? null : (
                  <ReferenceLine
                    x={shortDate(data.adoptionDate)}
                    stroke={AXIS_INK}
                    strokeDasharray="4 4"
                    label={{
                      value: t('adminAdoption', LOCALE),
                      position: 'insideTopLeft',
                      fill: LABEL_INK,
                      fontSize: 'var(--text-caption)',
                    }}
                  />
                )}

                {/* Gaps stay gaps. A day with no chamber measured has no
                    figure, and a line drawn across it would invent one. */}
                <Line
                  type="linear"
                  dataKey="overrun"
                  stroke={SERIES}
                  strokeWidth={2}
                  // A point on every measured day, so a day measured between
                  // two gaps is still seen. Straight segments: a smoothed
                  // curve overshoots and draws values nobody measured.
                  dot={{ r: 3, fill: SERIES, stroke: SURFACE, strokeWidth: 1 }}
                  activeDot={{ r: 5, stroke: SURFACE, strokeWidth: 2 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Loss and recovery (FR-ADM-03)
// ---------------------------------------------------------------------------

function LossSection({ data, now }: SectionProps): ReactNode {
  const loss = data.loss;

  // The whole range on the axis, as the trend has: a day with nothing lost
  // and nothing recovered is a day, not a missing column.
  const lossOn = new Map(data.lossByDay.map((row) => [row.date, row]));
  const days =
    data.lossByDay.length === 0
      ? []
      : everyDay(data.range.from, data.range.to).map((date) => ({
          label: shortDate(date),
          lost: lossOn.get(date)?.uncollectedPoisha ?? 0,
          recovered: lossOn.get(date)?.recoveredPoisha ?? 0,
        }));

  return (
    <Section testId="admin-section-loss" asOf={data.freshness.serverTs} now={now}>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label={t('adminNoShows', LOCALE)} value={num(loss.noShowCount)} />
        <Stat label={t('adminForgone', LOCALE)} value={taka(loss.forgonePoisha)} />
        {/* The honest half. A patient who prepaid and did not attend has
            already given the hospital its money, so it is named separately
            rather than counted as a loss. */}
        <Stat label={t('adminPrepaid', LOCALE)} value={taka(loss.prepaidPoisha)} />
        <Stat
          label={t('adminUncollected', LOCALE)}
          value={taka(loss.uncollectedPoisha)}
          testId="admin-uncollected"
        />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label={t('adminOffersMade', LOCALE)} value={num(loss.offered)} />
        <Stat label={t('adminOffersAccepted', LOCALE)} value={num(loss.accepted)} />
        <Stat
          label={t('adminRecovered', LOCALE)}
          value={taka(loss.recoveredPoisha)}
          tone="brand"
          testId="admin-recovered"
          note={
            loss.recoveryRate === null
              ? null
              : `${t('adminRecoveryRate', LOCALE)} ${percent(loss.recoveryRate)}`
          }
        />
        <Stat label={t('adminNetLoss', LOCALE)} value={taka(loss.netLossPoisha)} />
      </div>

      {days.length === 0 ? null : (
        <Card>
          <h2 className="text-title-sm">{t('adminLossChartTitle', LOCALE)}</h2>
          <div className="mt-3 h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              {/* Side by side, not stacked: a chair freed by a cancellation can
                  be recovered on a day with no no-show loss at all, so the two
                  are not parts of one whole. */}
              <BarChart data={days} barGap={2} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={false} />
                <YAxis
                  tick={TICK}
                  tickLine={false}
                  axisLine={false}
                  width={64}
                  tickFormatter={(value: number) => taka(value)}
                />
                <Tooltip
                  {...TOOLTIP}
                  cursor={{ fill: 'var(--brand-100)' }}
                  formatter={(value, name) => [taka(asNumber(value)), name]}
                />
                <Legend
                  iconType="square"
                  formatter={(value: string) => <span style={{ color: LABEL_INK }}>{value}</span>}
                />
                <Bar
                  dataKey="lost"
                  name={t('adminUncollected', LOCALE)}
                  fill={SERIES_NEUTRAL}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={16}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="recovered"
                  name={t('adminRecovered', LOCALE)}
                  fill={SERIES}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={16}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Revenue (FR-ADM-04)
// ---------------------------------------------------------------------------

const METHOD_KEY: Readonly<Record<string, ConsoleKey>> = {
  bkash: 'adminMethodBkash',
  nagad: 'adminMethodNagad',
  card: 'adminMethodCard',
  cash: 'adminMethodCash',
  at_hospital: 'adminMethodAtHospital',
  unpaid: 'adminMethodUnpaid',
};

const SERVICE_KEY: Readonly<Record<string, ConsoleKey>> = {
  consultation: 'adminServiceConsultation',
  test: 'adminServiceTest',
  bed: 'adminServiceBed',
  ambulance: 'adminServiceAmbulance',
};

function RevenueSection({ data, now }: SectionProps): ReactNode {
  const revenue = data.revenue;

  return (
    <Section testId="admin-section-revenue" asOf={data.freshness.snapshotAt} now={now}>
      <div className="grid grid-cols-3 gap-4">
        <Stat label={t('adminBilled', LOCALE)} value={taka(revenue.billedPoisha)} />
        <Stat label={t('adminCollected', LOCALE)} value={taka(revenue.collectedPoisha)} />
        <Stat label={t('adminRefunded', LOCALE)} value={taka(revenue.refundedPoisha)} />
      </div>

      <RevenueBars title={t('adminByDoctor', LOCALE)} slices={revenue.byDoctor.slice(0, 10)} />
      <RevenueBars title={t('adminByDepartment', LOCALE)} slices={revenue.byDepartment} />

      <RevenueTable
        title={t('adminByService', LOCALE)}
        slices={revenue.byService}
        labelOf={(label) => t(SERVICE_KEY[label] ?? 'adminServiceConsultation', LOCALE)}
        // Three of the four cannot have money in this version. The row says
        // so rather than being left out: a missing line reads as "we did not
        // look".
        noteOf={(slice) =>
          slice.bookings === 0 && slice.label !== 'consultation'
            ? t('adminServiceNotCharged', LOCALE)
            : null
        }
      />

      <RevenueTable
        title={t('adminByMethod', LOCALE)}
        slices={revenue.byMethod}
        labelOf={(label) => {
          const key = METHOD_KEY[label];
          return key === undefined ? label : t(key, LOCALE);
        }}
        noteOf={() => null}
      />
    </Section>
  );
}

/** Collected, by doctor or department. One colour: length carries the amount. */
function RevenueBars({
  title,
  slices,
}: {
  readonly title: string;
  readonly slices: readonly RevenueSlice[];
}): ReactNode {
  if (slices.length === 0) return null;

  // Nothing collected is a sentence, not a chart: an axis ticked ৳0.01 to
  // ৳0.04 over empty bars reads as a broken screen (`GR-03`, empty state).
  if (slices.every((slice) => slice.collectedPoisha === 0)) {
    return (
      <Card data-testid="admin-revenue-none">
        <h2 className="text-title-sm">
          {title} · {t('adminCollected', LOCALE)}
        </h2>
        <p className="mt-2 text-body-md text-ink-secondary">{t('adminNothingCollected', LOCALE)}</p>
      </Card>
    );
  }

  const rows = [...slices]
    .sort((a, b) => b.collectedPoisha - a.collectedPoisha)
    .map((slice) => ({
      label: slice.label,
      collected: slice.collectedPoisha,
      billed: slice.billedPoisha,
    }));

  return (
    <Card>
      <h2 className="text-title-sm">
        {title} · {t('adminCollected', LOCALE)}
      </h2>
      <div className={`mt-3 w-full ${rows.length > 5 ? 'h-80' : 'h-48'}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
          >
            <CartesianGrid stroke={GRID} horizontal={false} />
            <XAxis
              type="number"
              tick={TICK}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value: number) => taka(value)}
            />
            <YAxis
              type="category"
              dataKey="label"
              tick={{ ...TICK, fill: LABEL_INK }}
              tickLine={false}
              axisLine={false}
              width={170}
            />
            <Tooltip
              {...TOOLTIP}
              cursor={{ fill: 'var(--brand-100)' }}
              formatter={(value) => [taka(asNumber(value)), t('adminCollected', LOCALE)]}
            />
            <Bar
              dataKey="collected"
              fill={SERIES}
              radius={[0, 4, 4, 0]}
              maxBarSize={16}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function RevenueTable({
  title,
  slices,
  labelOf,
  noteOf,
}: {
  readonly title: string;
  readonly slices: readonly RevenueSlice[];
  readonly labelOf: (label: string) => string;
  readonly noteOf: (slice: RevenueSlice) => string | null;
}): ReactNode {
  if (slices.length === 0) return null;

  return (
    <Card>
      <h2 className="text-title-sm">{title}</h2>
      <table className="mt-3 w-full text-body-sm">
        <thead>
          <tr className="text-left text-caption text-ink-muted">
            <th scope="col" className="pb-2 font-normal">
              <span className="sr-only">{title}</span>
            </th>
            <th scope="col" className="pb-2 text-right font-normal">
              {t('adminBookings', LOCALE)}
            </th>
            <th scope="col" className="pb-2 text-right font-normal">
              {t('adminCollected', LOCALE)}
            </th>
            <th scope="col" className="pb-2 text-right font-normal">
              {t('adminRefunded', LOCALE)}
            </th>
          </tr>
        </thead>
        <tbody>
          {slices.map((slice) => {
            const note = noteOf(slice);
            return (
              <tr key={slice.label} className="border-t border-line-hairline">
                <th scope="row" className="py-2 text-left font-normal">
                  {labelOf(slice.label)}
                  {note === null ? null : (
                    <span className="block text-caption text-ink-muted">{note}</span>
                  )}
                </th>
                <td className="py-2 text-right tabular-nums">{num(slice.bookings)}</td>
                <td className="py-2 text-right tabular-nums">{taka(slice.collectedPoisha)}</td>
                <td className="py-2 text-right tabular-nums">{taka(slice.refundedPoisha)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Staff (FR-ADM-05)
// ---------------------------------------------------------------------------

function StaffSection({ data, now }: SectionProps): ReactNode {
  return (
    <Section testId="admin-section-staff" asOf={data.freshness.serverTs} now={now}>
      {data.staff.length === 0 ? (
        <Empty />
      ) : (
        <Card>
          <table className="w-full text-body-sm">
            <thead>
              <tr className="text-left text-caption text-ink-muted">
                <th scope="col" className="pb-2 font-normal">
                  {t('adminDoctor', LOCALE)}
                </th>
                <th scope="col" className="pb-2 text-right font-normal">
                  {t('adminMedianLate', LOCALE)}
                </th>
                <th scope="col" className="pb-2 text-right font-normal">
                  {t('adminWorstLate', LOCALE)}
                </th>
                <th scope="col" className="pb-2 text-right font-normal">
                  {t('adminOnTimeRate', LOCALE)}
                </th>
                <th scope="col" className="pb-2 text-right font-normal">
                  {t('adminAvgConsult', LOCALE)}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.staff.map((doctor) => (
                <tr key={doctor.doctorId} className="border-t border-line-hairline">
                  <th scope="row" className="py-2 text-left font-normal">
                    {doctor.doctorNameBn}
                    <span className="block text-caption text-ink-muted">
                      {doctor.departmentNameBn} ·{' '}
                      {format('adminChambersCount', LOCALE, { count: num(doctor.sessions) })}
                    </span>
                  </th>
                  <td className="py-2 text-right tabular-nums">
                    {doctor.medianDeltaMinutes === null
                      ? t('adminNeverStartedNote', LOCALE)
                      : minutes(doctor.medianDeltaMinutes)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {minutes(doctor.worstDeltaMinutes)}
                  </td>
                  <td className="py-2 text-right tabular-nums">{percent(doctor.onTimeRate)}</td>
                  <td className="py-2 text-right tabular-nums">
                    {doctor.avgConsultSeconds === null
                      ? '—'
                      : minutes(Math.round(doctor.avgConsultSeconds / 60))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Beds (FR-ADM-06)
// ---------------------------------------------------------------------------

function BedsSection({ data, now }: SectionProps): ReactNode {
  return (
    <Section testId="admin-section-beds" asOf={data.freshness.serverTs} now={now}>
      {data.beds.length === 0 ? (
        <Empty hint={t('adminBedsNone', LOCALE)} />
      ) : (
        <Card>
          <table className="w-full text-body-sm">
            <thead>
              <tr className="text-left text-caption text-ink-muted">
                <th scope="col" className="pb-2 font-normal">
                  {t('adminBedKind', LOCALE)}
                </th>
                <th scope="col" className="pb-2 text-right font-normal">
                  {t('adminBedOccupied', LOCALE)}
                </th>
                <th scope="col" className="pb-2 text-right font-normal">
                  {t('adminAdmissions', LOCALE)}
                </th>
                <th scope="col" className="pb-2 text-right font-normal">
                  {t('adminAlos', LOCALE)}
                </th>
                <th scope="col" className="pb-2 text-right font-normal">
                  {t('adminTurnover', LOCALE)}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.beds.map((bed) => (
                <tr key={bed.kind} className="border-t border-line-hairline">
                  <th scope="row" className="py-2 text-left font-normal">
                    {bedKind(bed.kind)}
                  </th>
                  <td className="py-2 text-right tabular-nums">
                    {num(bed.occupied)} / {num(bed.total)}
                  </td>
                  <td className="py-2 text-right tabular-nums">{num(bed.admissions)}</td>
                  <td className="py-2 text-right tabular-nums">{hours(bed.alosHours)}</td>
                  <td className="py-2 text-right tabular-nums">{hours(bed.turnoverHours)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Referrals (FR-ADM-07)
// ---------------------------------------------------------------------------

function ReferralsSection({ data, now }: SectionProps): ReactNode {
  const flow = data.referrals;

  return (
    <Section testId="admin-section-referrals" asOf={data.freshness.referralsAt} now={now}>
      {flow === null ? (
        <Empty hint={t('adminReferralsNone', LOCALE)} />
      ) : (
        <>
          <h2 className="text-title-sm">{t('adminSent', LOCALE)}</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label={t('adminSent', LOCALE)} value={num(flow.sentTotal)} />
            <Stat label={t('adminAccepted', LOCALE)} value={num(flow.sentAccepted)} />
            <Stat label={t('adminDeclined', LOCALE)} value={num(flow.sentDeclined)} />
            <Stat label={t('adminOpen', LOCALE)} value={num(flow.sentOpen)} />
          </div>

          <Stat
            label={t('adminLeaked', LOCALE)}
            value={num(flow.leaked)}
            note={t('adminLeakedNote', LOCALE)}
          />

          <h2 className="text-title-sm">{t('adminReceived', LOCALE)}</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label={t('adminReceived', LOCALE)} value={num(flow.receivedTotal)} />
            <Stat label={t('adminAccepted', LOCALE)} value={num(flow.receivedAccepted)} />
            <Stat label={t('adminDeclined', LOCALE)} value={num(flow.receivedDeclined)} />
            <Stat label={t('adminOpen', LOCALE)} value={num(flow.receivedOpen)} />
          </div>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Feedback (FR-ADM-08)
// ---------------------------------------------------------------------------

const COMPLAINT_KEY: Readonly<Record<ComplaintCategory, ConsoleKey>> = {
  wait: 'adminFeedbackWait',
  doctor: 'adminFeedbackDoctor',
  cleanliness: 'adminFeedbackCleanliness',
  billing: 'adminFeedbackBilling',
};

function FeedbackSection({ data, now }: SectionProps): ReactNode {
  const { summary, complaints } = data.feedback;

  const scoreOf = (category: ComplaintCategory): number | null => {
    if (category === 'wait') return summary.waitScore;
    if (category === 'doctor') return summary.doctorScore;
    if (category === 'cleanliness') return summary.cleanlinessScore;
    return summary.billingScore;
  };

  return (
    <Section testId="admin-section-feedback" asOf={data.freshness.feedbackAt} now={now}>
      {summary.responses === 0 ? (
        <Empty />
      ) : (
        <>
          <Stat label={t('adminFeedbackResponses', LOCALE)} value={num(summary.responses)} />

          <Card>
            <table className="w-full text-body-sm">
              <thead>
                <tr className="text-left text-caption text-ink-muted">
                  <th scope="col" className="pb-2 font-normal">
                    {t('adminFeedbackCategory', LOCALE)}
                  </th>
                  <th scope="col" className="pb-2 text-right font-normal">
                    {t('adminFeedbackScore', LOCALE)}
                  </th>
                  <th scope="col" className="pb-2 text-right font-normal">
                    {t('adminAnswered', LOCALE)}
                  </th>
                  <th scope="col" className="pb-2 text-right font-normal">
                    {t('adminComplaints', LOCALE)}
                  </th>
                </tr>
              </thead>
              <tbody>
                {complaints.map((complaint) => {
                  const score = scoreOf(complaint.category);
                  return (
                    <tr key={complaint.category} className="border-t border-line-hairline">
                      <th scope="row" className="py-2 text-left font-normal">
                        {t(COMPLAINT_KEY[complaint.category], LOCALE)}
                      </th>
                      <td className="py-2 text-right tabular-nums">
                        {score === null
                          ? '—'
                          : formatNumber(score, NUMERALS, {
                              minimumFractionDigits: 1,
                              maximumFractionDigits: 1,
                            })}
                      </td>
                      {/* Every average says how many people it rests on. An
                          average over four responses and one over four hundred
                          are not the same claim. */}
                      <td className="py-2 text-right text-ink-muted tabular-nums">
                        {num(complaint.answered)}
                      </td>
                      <td className="py-2 text-right tabular-nums">{num(complaint.complaints)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          {/* `FR-PAT-83`'s form is not built, so every row here came from the
              seeds. Saying so is the difference between demonstration data and
              a claim about real patients (`FR-DEM-07`). */}
          <p className="text-body-sm text-ink-muted">{t('adminFeedbackSeededOnly', LOCALE)}</p>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Forecast (FR-ADM-09)
// ---------------------------------------------------------------------------

const SLOT_KEY: Readonly<Record<ForecastSlot, ConsoleKey>> = {
  morning: 'adminSlotMorning',
  afternoon: 'adminSlotAfternoon',
  evening: 'adminSlotEvening',
};

const WEEKDAY_KEY: readonly ConsoleKey[] = [
  'adminWeekday0',
  'adminWeekday1',
  'adminWeekday2',
  'adminWeekday3',
  'adminWeekday4',
  'adminWeekday5',
  'adminWeekday6',
];

function ForecastSection({ data, now }: SectionProps): ReactNode {
  return (
    <Section testId="admin-section-forecast" asOf={data.freshness.serverTs} now={now}>
      {data.forecast.length === 0 ? (
        <Empty />
      ) : (
        <Card>
          <h2 className="text-title-sm">{t('adminForecastCaption', LOCALE)}</h2>
          <table className="mt-3 w-full text-body-sm">
            <thead>
              <tr className="text-left text-caption text-ink-muted">
                <th scope="col" className="pb-2 font-normal">
                  <span className="sr-only">{t('adminTabForecast', LOCALE)}</span>
                </th>
                <th scope="col" className="pb-2 text-right font-normal">
                  {t('adminForecastExpected', LOCALE)}
                </th>
                <th scope="col" className="pb-2 text-right font-normal">
                  {t('adminForecastRange', LOCALE)}
                </th>
                <th scope="col" className="pb-2 text-right font-normal">
                  {t('adminObservations', LOCALE)}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.forecast.map((point) => (
                <tr
                  key={`${String(point.weekday)}-${point.slot}`}
                  className="border-t border-line-hairline"
                >
                  <th scope="row" className="py-2 text-left font-normal">
                    {t(WEEKDAY_KEY[point.weekday] ?? 'adminWeekday0', LOCALE)}
                    <span className="pl-2 text-ink-muted">{t(SLOT_KEY[point.slot], LOCALE)}</span>
                  </th>
                  <td className="py-2 text-right tabular-nums">
                    {/* Null below two observations. A staffing figure invented
                        from one Friday is a figure somebody could roster
                        against (`PRD.md` §3.2). */}
                    {point.expected === null ? t('adminForecastThin', LOCALE) : num(point.expected)}
                  </td>
                  <td className="py-2 text-right text-ink-muted tabular-nums">
                    {point.low === null || point.high === null
                      ? '—'
                      : `${num(point.low)}–${num(point.high)}`}
                  </td>
                  <td className="py-2 text-right text-ink-muted tabular-nums">
                    {num(point.observations)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

interface SectionProps {
  readonly data: Dashboard;
  readonly now: Date;
}

function Shell({ children }: { readonly children: ReactNode }): ReactNode {
  const staffName = readDemoSession()?.staffName ?? null;

  return (
    <div className="min-h-screen">
      {/* FR-DEM-07: the demo says what it is, on screen, permanently. */}
      <p className="bg-warn-100 px-6 py-2 text-caption text-warn-700 print:hidden">
        {t('demoBanner', LOCALE)}
      </p>

      <main className="mx-auto flex max-w-6xl flex-col gap-5 p-6" data-testid="admin-dashboard">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="text-title-lg">{t('adminTitle', LOCALE)}</h1>
            {staffName === null ? null : <p className="text-body-sm text-ink-muted">{staffName}</p>}
          </div>
          <a
            href="/"
            className="flex min-h-touch items-center rounded-sm px-3 text-body-sm text-brand-600 hover:bg-brand-100 print:hidden"
          >
            {t('changeConsole', LOCALE)}
          </a>
        </header>

        {children}
      </main>
    </div>
  );
}

/** A section with its own age, which is the only age true of its figures. */
function Section({
  testId,
  asOf,
  now,
  children,
}: {
  readonly testId: string;
  readonly asOf: string | null;
  readonly now: Date;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section className="flex flex-col gap-4" data-testid={testId}>
      <FreshnessLine
        asOf={asOf === null ? null : new Date(asOf)}
        now={now}
        labels={{
          justNow: t('updatedJustNow', LOCALE),
          ago: t('updatedAgo', LOCALE),
          never: t('adminNeverRecorded', LOCALE),
          stale: t('staleWarning', LOCALE),
        }}
        formatMinutes={(value) => formatAge(value, LOCALE, NUMERALS)}
      />
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  tone = 'plain',
  testId,
  note = null,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: 'plain' | 'brand';
  readonly testId?: string;
  readonly note?: string | null;
}): ReactNode {
  return (
    <Card tone={tone === 'brand' ? 'brand' : 'default'} data-testid={testId}>
      <p className="text-caption text-ink-muted">{label}</p>
      <p
        className="mt-1 text-title-lg tabular-nums"
        data-testid={testId === undefined ? undefined : `${testId}-value`}
      >
        {value}
      </p>
      {note === null ? null : <p className="mt-1 text-caption text-ink-secondary">{note}</p>}
    </Card>
  );
}

function Empty({ hint }: { readonly hint?: string }): ReactNode {
  return (
    <Card data-testid="admin-empty">
      <p className="text-body-md text-ink-secondary">{t('adminNothingYet', LOCALE)}</p>
      <p className="mt-1 text-body-sm text-ink-muted">{hint ?? t('adminNothingYetHint', LOCALE)}</p>
    </Card>
  );
}

/** The shape of the screen, not a spinner (`GR-03`). */
function DashboardSkeleton(): ReactNode {
  return (
    <Shell>
      <div className="flex flex-col gap-4" aria-busy="true" data-testid="admin-loading">
        <div className="h-11 w-96 max-w-full rounded-md bg-sunken" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((slot) => (
            <div key={slot} className="h-24 rounded-md bg-sunken" />
          ))}
        </div>
        <div className="h-80 rounded-md bg-sunken" />
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function num(value: number): string {
  return formatNumber(value, NUMERALS);
}

function taka(poisha: number): string {
  // Chart ticks and tooltips hand back whatever the axis computed, which is
  // not always a whole number of poisha.
  return formatTaka(Math.round(poisha), NUMERALS);
}

function minutes(value: number | null): string {
  if (value === null) return '—';
  return `${num(value)} ${t('minutesShort', LOCALE)}`;
}

function hours(value: number | null): string {
  if (value === null) return '—';
  return `${num(value)} ${t('adminHours', LOCALE)}`;
}

function percent(rate: number | null): string {
  if (rate === null) return '—';
  return `${num(Math.round(rate * 100))}%`;
}

/** Recharts hands a tooltip value as a number, a string or an array. */
function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

/** Every Dhaka calendar date from `from` to `to`, inclusive, as `YYYY-MM-DD`. */
function everyDay(from: string, to: string): string[] {
  const dates: string[] = [];
  const at = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (at.getTime() <= end.getTime()) {
    dates.push(at.toISOString().slice(0, 10));
    at.setUTCDate(at.getUTCDate() + 1);
  }
  return dates;
}

/** `DD/MM`, which is as much as an axis tick can carry. */
function shortDate(iso: string): string {
  const [, month, day] = iso.split('-');
  if (month === undefined || day === undefined) return iso;
  return `${num(Number(day))}/${num(Number(month))}`;
}

function bedKind(kind: string): string {
  return kind in BED_KIND_NAMES ? bedKindName(kind as BedKindName, LOCALE) : kind;
}
