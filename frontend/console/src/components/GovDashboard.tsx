'use client';

/**
 * The national dashboard — `S-B-13` (`APP_FLOW.md` B8, `FR-GOV-01`…`06`).
 *
 * "Read-only national/district capacity map, ER load heat map, symptom spike
 * signals, anonymised benchmarking. No drill-down to an identifiable patient
 * exists in the UI or the API for this role."
 *
 * Four tabs, one per clause of that sentence. Nothing on this screen links
 * anywhere, and nothing can: every figure is a district's, a facility kind's
 * or the country's, and the API that serves them reads as a database role
 * that cannot open a patient's row at all (`gov.repo`, migration 0026).
 *
 * ## The map is a set of district tiles
 *
 * `FR-GOV-01` says "map". A drawn map of Bangladesh needs district boundary
 * data and a mapping library, neither of which this product has, and a new
 * dependency is the owner's call (`CLAUDE.md` §7). So the district layer is a
 * tile per district, national totals above — the same figures a map would
 * colour, each with its own age. STATUS records it as an open decision.
 *
 * ## Every section carries its own age
 *
 * Capacity is as old as the oldest ward that fed it; the heat map as old as
 * the newest thing any ER recorded; the signals as old as the newest signed
 * visit; the benchmark is computed at the read. One stamp for the screen would
 * be true of one of those and false of the rest (`CLAUDE.md` §5.8).
 *
 * ## The four states (`GR-03`)
 *
 * Loading is the shape of the screen. Each section fails on its own and says
 * so with a retry, because four reads are four chances. Offline keeps what
 * was last received on screen with its ages ageing, and says it is offline.
 * Empty is per section and says what would fill it.
 */

import { useCallback, useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import {
  bedKindName,
  BED_KIND_NAMES,
  districtName,
  divisionName,
  facilityKindName,
  format,
  formatClock,
  formatNumber,
  symptomSignalName,
  t,
  type BedKindName,
  type ConsoleKey,
  type Locale,
  formatAge,
  numeralsFor,
} from '@platform/i18n';
import { Button, Card, Chip, FreshnessLine, useLocale } from '@platform/ui';

import { ConsoleLanguageSwitch } from '@/components/ConsoleLanguageSwitch';
import { failureOf } from '@/lib/admin';
import { readDemoSession } from '@/lib/demo';
import {
  govApi,
  heatLevel,
  type Benchmark,
  type Benchmarks,
  type Capacity,
  type DistrictCapacity,
  type ErLoad,
  type SignalReading,
  type Signals,
} from '@/lib/gov';

/**
 * How often the screen re-reads.
 *
 * A minute: the capacity map and the heat map are live figures, and a
 * national screen left open through a flood should move without anybody
 * reloading it. Faster would be load for no information — a ward updates its
 * board every few minutes at best.
 */
const POLL_MS = 60_000;

// Every chart colour is a token (`FRONTEND.md` §1.1).
const SERIES = 'var(--brand-600)';
const AXIS_INK = 'var(--ink-muted)';
const TICK = { fill: AXIS_INK, fontSize: 'var(--text-caption)' } as const;

type Tab = 'capacity' | 'er' | 'signals' | 'benchmarks';

const TABS: readonly { readonly id: Tab; readonly key: ConsoleKey }[] = [
  { id: 'capacity', key: 'govTabCapacity' },
  { id: 'er', key: 'govTabEr' },
  { id: 'signals', key: 'govTabSignals' },
  { id: 'benchmarks', key: 'govTabBenchmarks' },
];

type Failure = 'error' | 'offline' | null;

interface Loaded {
  readonly capacity: Capacity | null;
  readonly er: ErLoad | null;
  readonly signals: Signals | null;
  readonly benchmarks: Benchmarks | null;
}

const NOTHING: Loaded = { capacity: null, er: null, signals: null, benchmarks: null };

const NO_FAILURES: Readonly<Record<Tab, Failure>> = {
  capacity: null,
  er: null,
  signals: null,
  benchmarks: null,
};

export function GovDashboard(): ReactNode {
  const locale = useLocale();
  const [data, setData] = useState<Loaded>(NOTHING);
  const [failures, setFailures] = useState<Readonly<Record<Tab, Failure>>>(NO_FAILURES);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>('capacity');
  const [now, setNow] = useState(() => new Date());

  const token = readDemoSession()?.token ?? '';

  const load = useCallback(async () => {
    const [capacity, er, signals, benchmarks] = await Promise.allSettled([
      govApi.capacity(token),
      govApi.erLoad(token),
      govApi.signals(token),
      govApi.benchmarks(token),
    ]);

    // A section that failed keeps what it last had: an aggregate that is ten
    // minutes old and says so beats an empty tab.
    setData((previous) => ({
      capacity: capacity.status === 'fulfilled' ? capacity.value : previous.capacity,
      er: er.status === 'fulfilled' ? er.value : previous.er,
      signals: signals.status === 'fulfilled' ? signals.value : previous.signals,
      benchmarks: benchmarks.status === 'fulfilled' ? benchmarks.value : previous.benchmarks,
    }));
    setFailures({
      capacity: capacity.status === 'rejected' ? failureOf(capacity.reason) : null,
      er: er.status === 'rejected' ? failureOf(er.reason) : null,
      signals: signals.status === 'rejected' ? failureOf(signals.reason) : null,
      benchmarks: benchmarks.status === 'rejected' ? failureOf(benchmarks.reason) : null,
    });
    setLoaded(true);
  }, [token]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void load();
    }, POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [load]);

  // The freshness lines have to age on screen with nothing else happening.
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 30_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  if (!loaded) return <GovSkeleton />;

  const offline = Object.values(failures).includes('offline');
  const nothing = Object.values(data).every((section) => section === null);

  if (nothing) {
    return (
      <Shell>
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-md bg-alert-100 p-4"
          data-testid={offline ? 'gov-offline' : 'gov-error'}
        >
          <p className="text-body-md text-alert-700">
            {t(offline ? 'govOffline' : 'govLoadFailed', locale)}
          </p>
          <Button variant="secondary" onClick={() => void load()} data-testid="gov-retry">
            {t('retry', locale)}
          </Button>
        </div>
      </Shell>
    );
  }

  const retry = (
    <Button variant="secondary" onClick={() => void load()} data-testid="gov-retry">
      {t('retry', locale)}
    </Button>
  );

  return (
    <Shell>
      {offline ? (
        <p
          role="status"
          className="rounded-sm bg-warn-100 px-3 py-2 text-body-sm text-warn-700"
          data-testid="gov-offline-banner"
        >
          {t('govOfflineStale', locale)}
        </p>
      ) : null}

      <Tabs selected={tab} onSelect={setTab} />

      <div role="tabpanel" id={`gov-panel-${tab}`} aria-labelledby={`gov-tab-${tab}`}>
        <SectionOrFailure
          section={data[tab] === null ? (failures[tab] ?? 'error') : null}
          retry={retry}
        >
          {tab === 'capacity' && data.capacity !== null ? (
            <CapacitySection data={data.capacity} now={now} />
          ) : null}
          {tab === 'er' && data.er !== null ? <ErSection data={data.er} now={now} /> : null}
          {tab === 'signals' && data.signals !== null ? (
            <SignalsSection data={data.signals} now={now} />
          ) : null}
          {tab === 'benchmarks' && data.benchmarks !== null ? (
            <BenchmarksSection data={data.benchmarks} now={now} />
          ) : null}
        </SectionOrFailure>
      </div>
    </Shell>
  );
}

/** A section that never arrived says so, with the retry, instead of a blank tab. */
function SectionOrFailure({
  section,
  retry,
  children,
}: {
  readonly section: Failure;
  readonly retry: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const locale = useLocale();
  if (section === null) return children;

  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-md bg-alert-100 p-4"
      data-testid="gov-section-failed"
    >
      <p className="text-body-md text-alert-700">
        {t(section === 'offline' ? 'govOffline' : 'govLoadFailed', locale)}
      </p>
      {retry}
    </div>
  );
}

/** The section switcher, as a real tab list: arrow keys move (`A11Y-05`). */
function Tabs({
  selected,
  onSelect,
}: {
  readonly selected: Tab;
  readonly onSelect: (tab: Tab) => void;
}): ReactNode {
  const locale = useLocale();
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();

    const index = TABS.findIndex((entry) => entry.id === selected);
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = TABS[(index + step + TABS.length) % TABS.length];
    if (next === undefined) return;

    onSelect(next.id);
    globalThis.document.getElementById(`gov-tab-${next.id}`)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={t('govTitle', locale)}
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
            id={`gov-tab-${entry.id}`}
            aria-selected={active}
            aria-controls={`gov-panel-${entry.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => {
              onSelect(entry.id);
            }}
            data-testid={`gov-tab-${entry.id}`}
            className="flex min-h-touch items-center rounded-sm px-3 text-body-md text-ink-secondary hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 aria-selected:bg-brand-100 aria-selected:font-semibold aria-selected:text-ink"
          >
            {t(entry.key, locale)}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Capacity (FR-GOV-01)
// ---------------------------------------------------------------------------

function CapacitySection({
  data,
  now,
}: {
  readonly data: Capacity;
  readonly now: Date;
}): ReactNode {
  const locale = useLocale();
  const { num, freeOfTotal, bedKind } = formattersFor(locale);
  const totals = data.totals;

  return (
    <Section testId="gov-section-capacity" asOf={totals.bedsAsOf} now={now}>
      <h2 className="text-title-sm">{t('govNational', locale)}</h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat
          label={t('govBedsFree', locale)}
          value={num(totals.bedFree)}
          note={format('govFreeOfTotal', locale, { total: num(totals.bedTotal) })}
          testId="gov-beds-free"
        />
        <Stat
          label={t('govIcuFree', locale)}
          value={totals.icuFree === null ? '—' : num(totals.icuFree)}
          note={
            totals.icuTotal === null
              ? t('govNoIcu', locale)
              : format('govFreeOfTotal', locale, { total: num(totals.icuTotal) })
          }
        />
        <Stat label={t('govBurnUnits', locale)} value={num(totals.burnUnitsOpen)} />
        <Stat label={t('govErActive', locale)} value={num(totals.erActive)} />
      </div>

      {/* `FR-GOV-01` asks for ventilators and blood; nothing records either.
          Said, not left out: a missing row on a capacity map reads as none. */}
      {data.unrecorded.length > 0 ? (
        <Card tone="warn" data-testid="gov-unrecorded">
          <p className="text-body-md text-warn-700">
            {t('govUnrecorded', locale)}:{' '}
            {data.unrecorded
              .map((item) =>
                t(
                  item === 'ventilators' ? 'govUnrecordedVentilators' : 'govUnrecordedBlood',
                  locale,
                ),
              )
              .join(', ')}
          </p>
          <p className="mt-1 max-w-prose text-body-sm text-ink-secondary">
            {t('govUnrecordedWhy', locale)}
          </p>
        </Card>
      ) : null}

      {totals.byKind.length > 0 ? (
        <Card>
          <table className="w-full text-body-sm" data-testid="gov-by-kind">
            <thead>
              <tr className="text-left text-caption text-ink-muted">
                <th className="py-1 pr-4 font-normal">{t('govBedKind', locale)}</th>
                <th className="py-1 pr-4 text-right font-normal">{t('govBedsFree', locale)}</th>
              </tr>
            </thead>
            <tbody>
              {totals.byKind.map((kind) => (
                <tr key={kind.kind} className="border-t border-line-hairline">
                  <td className="py-2 pr-4">{bedKind(kind.kind)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {freeOfTotal(kind.free, kind.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      <h2 className="text-title-sm">{t('govByDistrict', locale)}</h2>
      {data.districts.length === 0 ? (
        <Empty />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" data-testid="gov-districts">
          {data.districts.map((district) => (
            <li key={`${district.division}/${district.district}`}>
              <DistrictTile district={district} now={now} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function DistrictTile({
  district,
  now,
}: {
  readonly district: DistrictCapacity;
  readonly now: Date;
}): ReactNode {
  const locale = useLocale();
  const { num, freeOfTotal } = formattersFor(locale);
  return (
    <Card data-testid={`gov-district-${district.district}`}>
      <div className="flex flex-col gap-2">
        <div>
          <h3 className="text-title-sm">{districtName(district.district, locale)}</h3>
          <p className="text-caption text-ink-muted">
            {divisionName(district.division, locale)} ·{' '}
            {format('govFacilities', locale, { count: num(district.facilities) })}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-body-sm">
          <dt className="text-ink-secondary">{t('govBedsFree', locale)}</dt>
          <dd className="text-right tabular-nums">
            {district.bedTotal === 0
              ? t('govNoBeds', locale)
              : freeOfTotal(district.bedFree, district.bedTotal)}
          </dd>
          <dt className="text-ink-secondary">{t('govIcuFree', locale)}</dt>
          <dd className="text-right tabular-nums">
            {district.icuTotal === null || district.icuFree === null
              ? t('govNoIcu', locale)
              : freeOfTotal(district.icuFree, district.icuTotal)}
          </dd>
          <dt className="text-ink-secondary">{t('govBurnUnits', locale)}</dt>
          <dd className="text-right tabular-nums">{num(district.burnUnitsOpen)}</dd>
          <dt className="text-ink-secondary">{t('govErActive', locale)}</dt>
          <dd className="text-right tabular-nums">{num(district.erActive)}</dd>
        </dl>

        {/* A district with no inpatient beds has no bed age to report. */}
        {district.bedTotal > 0 ? <Freshness asOf={district.bedsAsOf} now={now} /> : null}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Emergency load (FR-GOV-02)
// ---------------------------------------------------------------------------

/** Five steps on the brand ramp; the dark two carry light text. */
const HEAT_CLASS: Readonly<Record<0 | 1 | 2 | 3 | 4, string>> = {
  0: 'bg-sunken text-ink-muted',
  1: 'bg-brand-100 text-ink',
  2: 'bg-brand-300 text-ink',
  3: 'bg-brand-600 text-ink-inverse',
  4: 'bg-brand-900 text-ink-inverse',
};

function ErSection({ data, now }: { readonly data: ErLoad; readonly now: Date }): ReactNode {
  const locale = useLocale();
  const { num } = formattersFor(locale);
  const numerals = numeralsFor(locale);
  const asOf = data.districts.reduce<string | null>(
    (age, district) =>
      district.asOf !== null && (age === null || district.asOf > age) ? district.asOf : age,
    null,
  );

  return (
    <Section testId="gov-section-er" asOf={asOf} now={now}>
      <div className="grid grid-cols-3 gap-4">
        <Stat label={t('govErActive', locale)} value={num(data.totals.open)} testId="gov-er-open" />
        <Stat label={t('govErOnTheWay', locale)} value={num(data.totals.onTheWay)} />
        <Stat label={t('govErRed', locale)} value={num(data.totals.red)} />
      </div>

      {data.districts.length === 0 ? (
        <Empty hint={t('govErNone', locale)} />
      ) : (
        <Card>
          <h2 className="text-title-sm">
            {format('govErCaption', locale, { hours: num(data.windowHours) })}
          </h2>
          <p className="mt-1 text-caption text-ink-muted">{t('govErLegend', locale)}</p>

          <div className="mt-3 overflow-x-auto">
            <table
              className="border-separate border-spacing-0.5 text-caption"
              data-testid="gov-heatmap"
            >
              <thead>
                <tr>
                  <th scope="col" className="pr-3 text-left font-normal text-ink-muted">
                    {t('govDistrict', locale)}
                  </th>
                  {data.hours.map((hour, index) => (
                    <th
                      key={hour}
                      scope="col"
                      className="min-w-7 font-normal whitespace-nowrap text-ink-muted"
                    >
                      {/* Every third hour is labelled: twenty-four clock times
                          in a row are unreadable at this size. */}
                      {index % 3 === 0 ? formatClock(hour, numerals) : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.districts.map((district) => (
                  <tr key={district.district} data-testid={`gov-heat-${district.district}`}>
                    <th scope="row" className="pr-3 text-left font-normal whitespace-nowrap">
                      <span className="text-body-sm text-ink">
                        {districtName(district.district, locale)}
                      </span>{' '}
                      <span className="text-ink-muted tabular-nums">{num(district.open)}</span>
                    </th>
                    {district.hourly.map((cell, index) => {
                      const hour = data.hours[index] ?? '';
                      return (
                        <td
                          key={hour}
                          className={`h-8 min-w-7 rounded-xs text-center tabular-nums ${
                            HEAT_CLASS[heatLevel(cell.cases, data.peak)]
                          }`}
                          aria-label={format('govErCell', locale, {
                            district: districtName(district.district, locale),
                            hour: formatClock(hour, numerals),
                            cases: num(cell.cases),
                            red: num(cell.red),
                          })}
                        >
                          {cell.cases > 0 ? num(cell.cases) : ''}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Symptom signals (FR-GOV-03)
// ---------------------------------------------------------------------------

const STATUS: Readonly<
  Record<SignalReading['status'], { readonly key: ConsoleKey; readonly tone: 'alert' | 'neutral' }>
> = {
  spike: { key: 'govSignalSpike', tone: 'alert' },
  normal: { key: 'govSignalNormal', tone: 'neutral' },
  too_little_history: { key: 'govSignalThin', tone: 'neutral' },
};

function SignalsSection({ data, now }: { readonly data: Signals; readonly now: Date }): ReactNode {
  const locale = useLocale();
  const { num } = formattersFor(locale);
  const spikes = data.readings.filter((reading) => reading.status === 'spike');

  return (
    <Section testId="gov-section-signals" asOf={data.asOf} now={now}>
      <div className="flex flex-col gap-1">
        <p className="text-body-sm text-ink-secondary">
          {format('govSignalsRule', locale, {
            min: num(data.rule.minCases),
            ratio: num(data.rule.ratio),
          })}
        </p>
        <p className="text-caption text-ink-muted">{t('govSignalsSource', locale)}</p>
      </div>

      {data.readings.length === 0 ? (
        <Empty hint={t('govSignalsNone', locale)} />
      ) : (
        <>
          {spikes.map((reading) => (
            <SpikeCard key={`${reading.district}/${reading.signal}`} reading={reading} />
          ))}

          <Card>
            <table className="w-full text-body-sm" data-testid="gov-signals">
              <thead>
                <tr className="text-left text-caption text-ink-muted">
                  <th className="py-1 pr-4 font-normal">{t('govDistrict', locale)}</th>
                  <th className="py-1 pr-4 font-normal">{t('govSignal', locale)}</th>
                  <th className="py-1 pr-4 text-right font-normal">
                    {t('govSignalThisWeek', locale)}
                  </th>
                  <th className="py-1 pr-4 text-right font-normal">
                    {t('govSignalUsual', locale)}
                  </th>
                  <th className="py-1 font-normal">{t('govSignalStatus', locale)}</th>
                </tr>
              </thead>
              <tbody>
                {data.readings.map((reading) => (
                  <tr
                    key={`${reading.district}/${reading.signal}`}
                    className="border-t border-line-hairline"
                    data-testid={`gov-signal-${reading.district}-${reading.signal}`}
                    data-status={reading.status}
                  >
                    <td className="py-2 pr-4">{districtName(reading.district, locale)}</td>
                    <td className="py-2 pr-4">{symptomSignalName(reading.signal, locale)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{num(reading.thisWeek)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {reading.usualWeek === null ? '—' : num(reading.usualWeek)}
                    </td>
                    <td className="py-2">
                      <Chip tone={STATUS[reading.status].tone}>
                        {t(STATUS[reading.status].key, locale)}
                      </Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </Section>
  );
}

/**
 * A spike, drawn against the days before it.
 *
 * The number alone says "eleven"; the bars say "eleven, where there used to be
 * one or two" — which is the claim being made, and the one a person deciding
 * whether to call a district office needs to see for themselves.
 */
function SpikeCard({ reading }: { readonly reading: SignalReading }): ReactNode {
  const locale = useLocale();
  const { num, shortDate } = formattersFor(locale);
  const points = reading.daily.map((point) => ({
    label: shortDate(point.day),
    cases: point.cases,
  }));

  return (
    <Card tone="alert" data-testid={`gov-spike-${reading.district}-${reading.signal}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-title-sm">
          {districtName(reading.district, locale)} · {symptomSignalName(reading.signal, locale)}
        </h2>
        <p className="text-body-sm tabular-nums">
          {t('govSignalThisWeek', locale)} {num(reading.thisWeek)} · {t('govSignalUsual', locale)}{' '}
          {reading.usualWeek === null ? '—' : num(reading.usualWeek)}
        </p>
      </div>
      <div className="mt-3 h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={false} interval={2} />
            <YAxis
              tick={TICK}
              tickLine={false}
              axisLine={false}
              width={28}
              allowDecimals={false}
              tickFormatter={(value: number) => num(value)}
            />
            <Tooltip
              cursor={{ fill: 'var(--bg-sunken)' }}
              formatter={(value) => [num(Number(value)), symptomSignalName(reading.signal, locale)]}
            />
            <Bar dataKey="cases" fill={SERIES} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Benchmarks (FR-GOV-04)
// ---------------------------------------------------------------------------

const MEASURE_KEY: Readonly<Record<Benchmark['measure'], ConsoleKey>> = {
  wait: 'govMeasureWait',
  turnaround: 'govMeasureTurnaround',
  score_wait: 'govMeasureScoreWait',
  score_doctor: 'govMeasureScoreDoctor',
  score_cleanliness: 'govMeasureScoreCleanliness',
  score_billing: 'govMeasureScoreBilling',
};

function BenchmarksSection({
  data,
  now,
}: {
  readonly data: Benchmarks;
  readonly now: Date;
}): ReactNode {
  const locale = useLocale();
  const { num } = formattersFor(locale);
  return (
    <Section testId="gov-section-benchmarks" asOf={data.asOf} now={now}>
      <p className="text-body-sm text-ink-secondary">
        {format('govBenchCaption', locale, { days: num(data.windowDays) })}
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {data.measures.map((measure) => (
          <MeasureCard key={measure.measure} measure={measure} />
        ))}
      </div>
    </Section>
  );
}

function MeasureCard({ measure }: { readonly measure: Benchmark }): ReactNode {
  const locale = useLocale();
  const { num, valueOf } = formattersFor(locale);
  const largest = Math.max(0, ...measure.entries.map((entry) => entry.value));

  return (
    <Card data-testid={`gov-measure-${measure.measure}`}>
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-title-sm">{t(MEASURE_KEY[measure.measure], locale)}</h2>
          <p className="text-caption text-ink-muted">
            {t(measure.better === 'lower' ? 'govBenchLower' : 'govBenchHigher', locale)}
            {measure.median === null
              ? ''
              : ` · ${format('govBenchMedian', locale, { value: valueOf(measure, measure.median) })}`}
          </p>
        </div>

        {measure.entries.length === 0 ? (
          <p className="text-body-sm text-ink-secondary">{t('govBenchNone', locale)}</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {measure.entries.map((entry, index) => (
              // Position, not identity: the list has no key a facility could
              // be recognised by, which is the point (`FR-GOV-04`).
              <li key={index} className="flex flex-col gap-1" data-testid="gov-bench-entry">
                <div className="flex items-baseline justify-between gap-2 text-body-sm">
                  <span>
                    <span className="text-ink-muted tabular-nums">{num(index + 1)}.</span>{' '}
                    {facilityKindName(entry.kind, locale)}
                  </span>
                  <span className="tabular-nums">
                    {valueOf(measure, entry.value)}{' '}
                    <span className="text-caption text-ink-muted">
                      {format('govBenchSample', locale, { count: num(entry.sample) })}
                    </span>
                  </span>
                </div>
                <div className="h-2 rounded-pill bg-sunken" aria-hidden="true">
                  <div
                    className="h-2 rounded-pill bg-brand-600"
                    style={{
                      width: `${String(largest === 0 ? 0 : (entry.value / largest) * 100)}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ol>
        )}

        {measure.tooFew > 0 ? (
          <p className="text-caption text-ink-muted">
            {format('govBenchTooFew', locale, { count: num(measure.tooFew) })}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * The figures on this screen, in the language it is being read in.
 *
 * Built from the locale on each render, so a component destructures the
 * ones it uses and every call site reads as it did when the screen was
 * Bangla-only.
 */
function formattersFor(locale: Locale) {
  const numerals = numeralsFor(locale);

  /** A measure's figure with its unit: minutes, hours, or a score out of five. */
  function valueOf(measure: Benchmark, value: number): string {
    if (measure.measure === 'wait') return `${num(value)} ${t('minutesShort', locale)}`;
    if (measure.measure === 'turnaround') return `${num(value)} ${t('adminHours', locale)}`;
    return `${num(value)} ${t('govOutOfFive', locale)}`;
  }

  function num(value: number): string {
    return formatNumber(value, numerals);
  }

  /**
   * "২৮টির মধ্যে ৭টি" — the total first, the way the sentence runs in Bangla.
   * Setting the free count before "২৮টির মধ্যে" read as "7 of-28", a number
   * dropped in front of a phrase it does not belong to.
   */
  function freeOfTotal(free: number, total: number): string {
    return format('govFreeOfTotalInline', locale, { free: num(free), total: num(total) });
  }

  /** `DD/MM`, which is as much as an axis tick can carry. */
  function shortDate(iso: string): string {
    const [, month, day] = iso.split('-');
    if (month === undefined || day === undefined) return iso;
    return `${num(Number(day))}/${num(Number(month))}`;
  }

  function bedKind(kind: string): string {
    return kind in BED_KIND_NAMES ? bedKindName(kind as BedKindName, locale) : kind;
  }

  return { num, freeOfTotal, shortDate, bedKind, valueOf };
}
// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Shell({ children }: { readonly children: ReactNode }): ReactNode {
  const locale = useLocale();
  const staffName = readDemoSession()?.staffName ?? null;

  return (
    <div className="min-h-screen">
      {/* FR-DEM-07: the demo says what it is, on screen, permanently. */}
      <p className="bg-warn-100 px-6 py-2 text-caption text-warn-700 print:hidden">
        {t('demoBanner', locale)}
      </p>

      <main className="mx-auto flex max-w-6xl flex-col gap-5 p-6" data-testid="gov-dashboard">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="text-title-lg">{t('govTitle', locale)}</h1>
            {staffName === null ? null : <p className="text-body-sm text-ink-muted">{staffName}</p>}
          </div>
          <div className="flex items-center gap-3 print:hidden">
            <ConsoleLanguageSwitch className="" />
            <a
              href="/"
              className="flex min-h-touch items-center rounded-sm px-3 text-body-sm text-brand-600 hover:bg-brand-100"
            >
              {t('changeConsole', locale)}
            </a>
          </div>
        </header>

        {/* FR-GOV-06, said where it is true: nothing below names anybody. */}
        <p className="text-body-sm text-ink-secondary" data-testid="gov-aggregate-only">
          {t('govAggregateOnly', locale)}
        </p>

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
      <Freshness asOf={asOf} now={now} />
      {children}
    </section>
  );
}

function Freshness({ asOf, now }: { readonly asOf: string | null; readonly now: Date }): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  return (
    <FreshnessLine
      asOf={asOf === null ? null : new Date(asOf)}
      now={now}
      labels={{
        justNow: t('updatedJustNow', locale),
        ago: t('updatedAgo', locale),
        never: t('adminNeverRecorded', locale),
        stale: t('staleWarning', locale),
      }}
      formatMinutes={(value) => formatAge(value, locale, numerals)}
    />
  );
}

function Stat({
  label,
  value,
  note = null,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly note?: string | null;
  readonly testId?: string;
}): ReactNode {
  return (
    <Card data-testid={testId}>
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
  const locale = useLocale();
  return (
    <Card data-testid="gov-empty">
      <p className="text-body-md text-ink-secondary">{t('adminNothingYet', locale)}</p>
      {hint === undefined ? null : <p className="mt-1 text-body-sm text-ink-muted">{hint}</p>}
    </Card>
  );
}

/** The shape of the screen, not a spinner (`GR-03`). */
function GovSkeleton(): ReactNode {
  return (
    <Shell>
      <div className="flex flex-col gap-4" aria-busy="true" data-testid="gov-loading">
        <div className="h-11 w-96 max-w-full rounded-md bg-sunken" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((slot) => (
            <div key={slot} className="h-24 rounded-md bg-sunken" />
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((slot) => (
            <div key={slot} className="h-40 rounded-md bg-sunken" />
          ))}
        </div>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
