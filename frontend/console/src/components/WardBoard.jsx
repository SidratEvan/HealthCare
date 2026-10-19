'use client';

/**
 * The ward / bed board — `S-B-06` (`APP_FLOW.md` B3, `FR-BED-01`…`07`).
 *
 * Laid out like the reception console so a hospital's staff learn one shape:
 * navigation rail and offline block on the left, the board in the middle,
 * and a right column with the bed panel, `<CapacityMirror>`, tomorrow's
 * forecast and `LIST-B06-PENDING`.
 *
 * ## The mirror is not decoration
 *
 * `FR-BED-06`: "The board displays what the public app is currently showing,
 * so the consequence of staleness is visible to staff." The right column
 * carries the figure a family's phone is showing for each kind of bed, with
 * its age — and, when the tiles on this screen say something different, says
 * so beside it. A ward that has not touched its board in four hours sees its
 * own ICU go amber there, which is the whole mechanism by which the numbers
 * stay true (`PRD.md` §3 principle 5).
 *
 * ## The four states (`GR-03`)
 *
 * Loading is the shape of the board, not a spinner. An error says what failed
 * and offers the retry. An empty hospital says it has no wards and who adds
 * them. Offline keeps the board on screen, working, with the offline block
 * counting what is waiting and every freshness line ageing honestly.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { BED_KINDS, forecastTomorrow, tallyByKind } from '@platform/domain';
import {
  bedKindName,
  format,
  formatNumber,
  t,
  formatAge,
  numeralsFor,
  localName,
} from '@platform/i18n';
import {
  BedTile,
  Button,
  CapacityMirror,
  FilterChip,
  FreshnessLine,
  ConsoleHelp,
  ConsolePageHeader,
  ToastProvider,
  useToast,
  useLocale,
} from '@platform/ui';

import { BedPanel } from '@/components/BedPanel';
import { ConsoleWorkspaceFrame } from '@/components/ConsoleWorkspaceFrame';
import { DemoBanner } from '@/components/DemoBanner';
import { OfflineBlock } from '@/components/OfflineBlock';
import { PendingAdmissions } from '@/components/PendingAdmissions';
import { useBedBoard } from '@/hooks/useBedBoard';
import { shownState, stateLabel, tileDetail } from '@/lib/bedCopy';
import { readDemoSession } from '@/lib/demo';
import { WARD_WORKSPACE as COPY } from '@/lib/wardEmergencyMessages';
import { WARD_STATES, wardAttention, wardStateCounts } from '@/lib/wardWorkspace';
import '@platform/ui/console-ward.css';

/** The demo principal (CLAUDE.md §4.1). Supabase Auth replaces this one function. */
function readToken() {
  return readDemoSession()?.token ?? null;
}

export function WardBoard() {
  return (
    <ToastProvider placement="console">
      <BoardBody />
    </ToastProvider>
  );
}

function BoardBody() {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const { show } = useToast();
  const session = readDemoSession();
  const hospitalId = session?.hospitalId ?? '';

  const board = useBedBoard({ hospitalId, getToken: readToken });

  const [now, setNow] = useState(() => new Date());
  // A ward id, or 'all' for every ward on one screen.
  const [ward, setWard] = useState('all');
  const [stateFilter, setStateFilter] = useState(null);
  const [selectedBedId, setSelectedBedId] = useState(null);
  // An ER case the ward chose a bed for from the pending list: the panel
  // opens on that bed's admit form with the case already chosen.
  const [admitCaseId, setAdmitCaseId] = useState(null);

  // The freshness lines and the cleaning timers age on screen with nothing
  // else happening — that is what they are for (`FR-OFF-03`).
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  // A refused action is said once, as a sentence (`SY-03`).
  useEffect(() => {
    if (board.lastRefusal === null) return;
    show({
      title:
        board.lastRefusal === 'patient_already_admitted'
          ? t('patientAlreadyAdmitted', locale)
          : t('bedActionRefused', locale),
      tone: 'caution',
    });
    board.clearRefusal();
  }, [board, show, locale]);

  const onProblem = useCallback(
    (message) => {
      show({ title: message, tone: 'caution' });
    },
    [show],
  );

  const wardNames = useMemo(
    () =>
      new Map(
        (board.board?.wards ?? []).map((entry) => [
          entry.id,
          localName(locale, entry.nameBn, entry.nameEn),
        ]),
      ),
    [board.board, locale],
  );

  const at = now.toISOString();
  const tallies = useMemo(() => tallyByKind(board.beds, at, BED_KINDS), [board.beds, at]);

  if (hospitalId === '' || session === null) {
    return <Notice>{t('noSession', locale)}</Notice>;
  }

  if (board.loading) {
    // GR-03 loading: the shape of the board.
    return (
      <div className="flex min-h-screen gap-6 p-6" aria-busy="true" data-testid="board-loading">
        <div className="w-52 shrink-0 rounded-md bg-sunken" />
        <div className="grid flex-1 grid-cols-6 gap-3">
          {Array.from({ length: 18 }, (_, index) => (
            <div key={index} className="h-20 rounded-md bg-sunken" />
          ))}
        </div>
      </div>
    );
  }

  if (board.failed || board.board === null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p role="alert" className="text-body-lg text-ink-secondary" data-testid="board-failed">
          {t('loadFailed', locale)}
        </p>
        <Button variant="secondary" onClick={board.retry}>
          {t('retry', locale)}
        </Button>
      </div>
    );
  }

  const counts = wardStateCounts(board.beds, at);
  const attention = wardAttention(board.beds, at);
  const loaded = board.board;
  const wards = loaded.wards;
  const selectedBed = board.beds.find((bed) => bed.id === selectedBedId) ?? null;
  const shownWards = ward === 'all' ? wards : wards.filter((entry) => entry.id === ward);

  const mirrorRows = (board.published?.byKind ?? []).map((entry) => ({
    key: entry.kind,
    name: bedKindName(entry.kind, locale),
    publishedFree: entry.free,
    publishedTotal: entry.total,
    boardFree: tallies.find((tally) => tally.kind === entry.kind)?.free ?? 0,
    asOf: entry.asOf === null ? null : new Date(entry.asOf),
  }));

  const forecast = forecastTomorrow(board.beds, at, loaded.today, BED_KINDS);
  const unforecast = forecast.reduce((sum, entry) => sum + entry.unforecast, 0);

  const freshness = {
    justNow: t('updatedJustNow', locale),
    ago: t('updatedAgo', locale),
    never: t('neverConfirmed', locale),
    stale: t('staleWarning', locale),
  };
  const minutes = (value) => formatAge(value, locale, numerals);

  return (
    <div className="ward-workspace" data-testid="ward-board">
      <ConsoleWorkspaceFrame
        session={session}
        workspace={COPY.title}
        rail="navBeds"
        navigation={[
          {
            id: 'beds',
            label: COPY.board,
            current: true,
            roles: ['ward'],
            enabled: true,
            onSelect: () => {
              document.getElementById('ward-tiles')?.scrollIntoView({ block: 'start' });
            },
          },
          {
            id: 'waiting',
            label: COPY.waiting,
            roles: ['ward'],
            enabled: true,
            onSelect: () => {
              document.getElementById('ward-waiting')?.scrollIntoView({ block: 'start' });
              document.getElementById('ward-waiting')?.focus();
            },
          },
        ]}
        actions={
          <>
            <div className="ward-connection">
              <OfflineBlock
                connected={board.connected}
                pendingCount={board.pendingCount}
                lastServerTs={board.lastServerTs}
                stuckCount={board.stuckCount}
                onRetryStuck={() => {
                  void board.retryStuck();
                }}
                onDiscardStuck={() => {
                  void board.discardStuck();
                }}
                durable={board.durable}
                locale={locale}
                now={now}
              />
            </div>
            <ConsoleHelp
              topic={{
                id: selectedBedId === null ? 'ward-board' : 'ward-bed',
                title: selectedBedId === null ? COPY.board : COPY.title,
                steps: [COPY.helpStates, COPY.helpWaiting, COPY.helpOffline, COPY.helpMirror],
              }}
            />
            <small>{session.staffName}</small>
            <a className="cf-work-switch" href="/">
              {t('changeConsole', locale)}
            </a>
          </>
        }
      >
        <DemoBanner />
        <ConsolePageHeader
          title={COPY.board}
          description={COPY.description}
          actions={
            <FreshnessLine
              asOf={board.lastServerTs === null ? null : new Date(board.lastServerTs)}
              now={now}
              staleAfterMinutes={loaded.staleAfterMinutes}
              labels={{ ...freshness, never: t('neverSynced', locale) }}
              formatMinutes={minutes}
            />
          }
        />
        <div className="ward-layout">
          <div className="ward-board-content" id="ward-tiles">
            {wards.length === 0 ? (
              <div data-testid="board-empty">
                <p className="text-body-lg text-ink-secondary">{t('noWards', locale)}</p>
                <p className="text-body-sm text-ink-muted">{t('noWardsHint', locale)}</p>
              </div>
            ) : (
              <>
                <div className="ward-counts" role="group" aria-label={COPY.allStates[locale]}>
                  {WARD_STATES.map((state) => (
                    <button
                      key={state}
                      type="button"
                      data-testid={`ward-filter-${state}`}
                      data-state={state}
                      aria-pressed={stateFilter === state}
                      onClick={() => setStateFilter(stateFilter === state ? null : state)}
                    >
                      <strong>{formatNumber(counts[state], numerals)}</strong>
                      <span>{stateLabel(state, locale)}</span>
                    </button>
                  ))}
                </div>
                {attention.length === 0 ? null : (
                  <section
                    className="ward-attention"
                    aria-label={COPY.attention[locale]}
                    data-testid="ward-attention"
                  >
                    <h2>{COPY.attention[locale]}</h2>
                    {attention.map((bed) => (
                      <div key={bed.id}>
                        <span>
                          <strong>{bed.label}</strong> · {stateLabel(shownState(bed, now), locale)}{' '}
                          · {tileDetail(bed, now, locale)}
                        </span>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setSelectedBedId(bed.id);
                            setAdmitCaseId(null);
                          }}
                        >
                          {COPY.openBed[locale]}
                        </Button>
                      </div>
                    ))}
                  </section>
                )}
                {/* TAB-B06-<ward> */}
                <div
                  className="mb-4 flex flex-wrap gap-2"
                  role="group"
                  aria-label={t('allWards', locale)}
                >
                  <FilterChip
                    selected={ward === 'all'}
                    onToggle={() => {
                      setWard('all');
                    }}
                  >
                    {t('allWards', locale)}
                  </FilterChip>
                  {wards.map((entry) => (
                    <FilterChip
                      key={entry.id}
                      selected={ward === entry.id}
                      onToggle={() => {
                        setWard(entry.id);
                      }}
                    >
                      {localName(locale, entry.nameBn, entry.nameEn)}
                    </FilterChip>
                  ))}
                </div>

                <div className="flex flex-col gap-6">
                  {shownWards.map((entry) => {
                    const beds = board.beds.filter(
                      (bed) =>
                        bed.wardId === entry.id &&
                        (stateFilter === null || shownState(bed, now) === stateFilter),
                    );
                    return (
                      <section
                        key={entry.id}
                        className="ward-group"
                        aria-labelledby={`ward-${entry.id}`}
                      >
                        <h2 id={`ward-${entry.id}`} className="mb-2 text-title-sm text-ink">
                          {localName(locale, entry.nameBn, entry.nameEn)}{' '}
                          <span className="text-body-sm text-ink-muted">
                            ·{' '}
                            {format('floorN', locale, {
                              floor: formatNumber(entry.floor, numerals),
                            })}{' '}
                            · {bedKindName(entry.kind, locale)}
                          </span>
                        </h2>
                        {beds.length === 0 ? (
                          <p className="ward-empty-filter">{COPY.emptyFilter[locale]}</p>
                        ) : null}
                        <div className="ward-tiles">
                          {beds.map((bed) => (
                            <BedTile
                              key={bed.id}
                              label={bed.label}
                              state={shownState(bed, now)}
                              stateLabel={stateLabel(shownState(bed, now), locale)}
                              detail={tileDetail(bed, now, locale)}
                              selected={bed.id === selectedBedId}
                              pending={board.pendingBedIds.has(bed.id)}
                              pendingLabel={t('bedPendingSync', locale)}
                              onSelect={() => {
                                setSelectedBedId(bed.id === selectedBedId ? null : bed.id);
                                setAdmitCaseId(null);
                              }}
                            />
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* --- right column ------------------------------------------------ */}
          <aside className="ward-sidebar">
            {selectedBed === null ? (
              <div className="rounded-md border border-dashed border-line-strong p-4">
                <p className="text-title-sm text-ink">{t('chooseBed', locale)}</p>
                <p className="text-body-sm text-ink-muted">{t('chooseBedHint', locale)}</p>
              </div>
            ) : (
              <BedPanel
                key={`${selectedBed.id}:${admitCaseId ?? ''}`}
                bed={selectedBed}
                wardName={wardNames.get(selectedBed.wardId) ?? ''}
                wardNames={wardNames}
                beds={board.beds}
                requests={board.requests}
                handoffs={board.handoffs}
                admitCaseId={admitCaseId}
                locale={locale}
                now={now}
                today={loaded.today}
                connected={board.connected}
                pending={board.pendingBedIds.has(selectedBed.id)}
                board={board}
                onClose={() => {
                  setSelectedBedId(null);
                  setAdmitCaseId(null);
                }}
                onProblem={onProblem}
              />
            )}

            <div className="ward-mirror">
              <CapacityMirror
                title={t('mirrorTitle', locale)}
                subtitle={t('mirrorSubtitle', locale)}
                rows={mirrorRows}
                now={now}
                staleAfterMinutes={loaded.staleAfterMinutes}
                freshnessLabels={freshness}
                formatMinutes={minutes}
                freeOfTotal={t('mirrorFreeOfTotal', locale)}
                mismatch={t('mirrorMismatch', locale)}
                empty={t('mirrorEmpty', locale)}
                formatCount={(value) => formatNumber(value, numerals)}
              />
            </div>
            {/* FR-BED-04: a forecast, for staff, labelled as such. */}
            {forecast.length === 0 ? null : (
              <section
                aria-labelledby="forecast-title"
                data-testid="forecast"
                className="rounded-md border border-line bg-surface p-4"
              >
                <h2 id="forecast-title" className="text-title-sm text-ink">
                  {t('forecastTitle', locale)}
                </h2>
                <p className="text-caption text-ink-muted">{t('forecastStaffOnly', locale)}</p>
                <ul className="mt-2 flex flex-col gap-1 text-body-sm">
                  {forecast.map((entry) => (
                    <li key={entry.kind} className="flex justify-between gap-3">
                      <span className="text-ink">{bedKindName(entry.kind, locale)}</span>
                      <span className="tabular-nums text-ink-secondary">
                        {format('forecastRow', locale, {
                          now: formatNumber(entry.freeNow, numerals),
                          tomorrow: formatNumber(entry.freeTomorrow, numerals),
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
                {unforecast === 0 ? null : (
                  <p className="mt-2 text-caption text-ink-muted">
                    {format('forecastBlind', locale, { count: formatNumber(unforecast, numerals) })}
                  </p>
                )}
              </section>
            )}

            <div id="ward-waiting" tabIndex={-1}>
              <PendingAdmissions
                requests={board.requests}
                handoffs={board.handoffs}
                onAdmitHandoff={(caseId, bedId) => {
                  setSelectedBedId(bedId);
                  setAdmitCaseId(caseId);
                }}
                failed={board.requestsFailed}
                connected={board.connected}
                beds={board.beds}
                locale={locale}
                now={now}
                onRespond={board.respond}
                onAnswered={() => {
                  show({ title: t('pendingAnswered', locale), tone: 'positive' });
                }}
                onProblem={onProblem}
              />
            </div>
          </aside>
        </div>
      </ConsoleWorkspaceFrame>
    </div>
  );
}

function Notice({ children }) {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-body-lg text-ink-muted">{children}</p>
    </div>
  );
}
