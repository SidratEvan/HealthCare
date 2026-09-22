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

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { BED_KINDS, forecastTomorrow, tallyByKind, type Timestamp } from '@platform/domain';
import { bedKindName, format, formatNumber, t, type Locale } from '@platform/i18n';
import {
  BedTile,
  Button,
  CapacityMirror,
  FilterChip,
  FreshnessLine,
  ToastProvider,
  useToast,
  type CapacityMirrorRow,
} from '@platform/ui';

import { BedPanel } from '@/components/BedPanel';
import { OfflineBlock } from '@/components/OfflineBlock';
import { PendingAdmissions } from '@/components/PendingAdmissions';
import { useBedBoard } from '@/hooks/useBedBoard';
import { NUMERALS, shownState, stateLabel, tileDetail } from '@/lib/bedCopy';
import { readDemoSession } from '@/lib/demo';

const LOCALE: Locale = 'bn';

/** `APP_FLOW.md` B1.1's rail. Beds is this screen; the rest are other consoles. */
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

export function WardBoard(): ReactNode {
  return (
    <ToastProvider placement="console">
      <BoardBody />
    </ToastProvider>
  );
}

function BoardBody(): ReactNode {
  const locale = LOCALE;
  const { show } = useToast();
  const session = readDemoSession();
  const hospitalId = session?.hospitalId ?? '';

  const board = useBedBoard({ hospitalId, getToken: readToken });

  const [now, setNow] = useState(() => new Date());
  // A ward id, or 'all' for every ward on one screen.
  const [ward, setWard] = useState<string>('all');
  const [selectedBedId, setSelectedBedId] = useState<string | null>(null);

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
    (message: string) => {
      show({ title: message, tone: 'caution' });
    },
    [show],
  );

  const wardNames = useMemo(
    () => new Map((board.board?.wards ?? []).map((entry) => [entry.id, entry.nameBn])),
    [board.board],
  );

  const at = now.toISOString() as Timestamp;
  const tallies = useMemo(() => tallyByKind(board.beds, at, BED_KINDS), [board.beds, at]);

  if (hospitalId === '') {
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

  const loaded = board.board;
  const wards = loaded.wards;
  const selectedBed = board.beds.find((bed) => bed.id === selectedBedId) ?? null;
  const shownWards = ward === 'all' ? wards : wards.filter((entry) => entry.id === ward);

  const mirrorRows: CapacityMirrorRow[] = (board.published?.byKind ?? []).map((entry) => ({
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
  const minutes = (value: number): string =>
    `${formatNumber(value, NUMERALS)} ${t('minutesShort', locale)}`;

  return (
    <div className="flex min-h-screen" data-testid="ward-board">
      {/* --- navigation rail ------------------------------------------------- */}
      <nav aria-label={t('navBeds', locale)} className="w-52 shrink-0 border-r border-line p-4">
        <ul className="flex flex-col gap-1">
          {NAV_ITEMS.map((key) => (
            <li key={key}>
              <span
                aria-current={key === 'navBeds' ? 'page' : undefined}
                className="flex min-h-touch items-center rounded-sm px-3 text-body-md aria-[current=page]:bg-brand-100 aria-[current=page]:font-semibold"
              >
                {t(key, locale)}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-6">
          <OfflineBlock
            connected={board.connected}
            pendingCount={board.pendingCount}
            lastServerTs={board.lastServerTs}
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
            <h1 className="font-reading text-title-lg text-ink">{t('wardBoardTitle', locale)}</h1>
            <p className="text-body-sm text-ink-muted">
              {loaded.hospitalNameBn}
              {session?.staffName === undefined ? '' : ` · ${session.staffName}`}
            </p>
            <FreshnessLine
              asOf={board.lastServerTs === null ? null : new Date(board.lastServerTs)}
              now={now}
              staleAfterMinutes={loaded.staleAfterMinutes}
              labels={{ ...freshness, never: t('neverSynced', locale) }}
              formatMinutes={minutes}
            />
          </div>
          <a
            href="/"
            className="flex min-h-touch items-center rounded-sm px-3 text-body-sm text-brand-600 hover:bg-brand-100"
          >
            {t('changeConsole', locale)}
          </a>
        </header>

        <main className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-auto p-6">
            {wards.length === 0 ? (
              <div data-testid="board-empty">
                <p className="text-body-lg text-ink-secondary">{t('noWards', locale)}</p>
                <p className="text-body-sm text-ink-muted">{t('noWardsHint', locale)}</p>
              </div>
            ) : (
              <>
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
                      {entry.nameBn}
                    </FilterChip>
                  ))}
                </div>

                <div className="flex flex-col gap-6">
                  {shownWards.map((entry) => {
                    const beds = board.beds.filter((bed) => bed.wardId === entry.id);
                    return (
                      <section key={entry.id} aria-labelledby={`ward-${entry.id}`}>
                        <h2 id={`ward-${entry.id}`} className="mb-2 text-title-sm text-ink">
                          {entry.nameBn}{' '}
                          <span className="text-body-sm text-ink-muted">
                            ·{' '}
                            {format('floorN', locale, {
                              floor: formatNumber(entry.floor, NUMERALS),
                            })}{' '}
                            · {bedKindName(entry.kind, locale)}
                          </span>
                        </h2>
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
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
          <aside className="w-96 shrink-0 space-y-4 overflow-auto border-l border-line p-4">
            {selectedBed === null ? (
              <div className="rounded-md border border-dashed border-line-strong p-4">
                <p className="text-title-sm text-ink">{t('chooseBed', locale)}</p>
                <p className="text-body-sm text-ink-muted">{t('chooseBedHint', locale)}</p>
              </div>
            ) : (
              <BedPanel
                key={selectedBed.id}
                bed={selectedBed}
                wardName={wardNames.get(selectedBed.wardId) ?? ''}
                wardNames={wardNames}
                beds={board.beds}
                requests={board.requests}
                locale={locale}
                now={now}
                today={loaded.today}
                connected={board.connected}
                pending={board.pendingBedIds.has(selectedBed.id)}
                board={board}
                onClose={() => {
                  setSelectedBedId(null);
                }}
                onProblem={onProblem}
              />
            )}

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
              formatCount={(value) => formatNumber(value, NUMERALS)}
            />

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
                          now: formatNumber(entry.freeNow, NUMERALS),
                          tomorrow: formatNumber(entry.freeTomorrow, NUMERALS),
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
                {unforecast === 0 ? null : (
                  <p className="mt-2 text-caption text-ink-muted">
                    {format('forecastBlind', locale, { count: formatNumber(unforecast, NUMERALS) })}
                  </p>
                )}
              </section>
            )}

            <PendingAdmissions
              requests={board.requests}
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
          </aside>
        </main>
      </div>
    </div>
  );
}

function Notice({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-body-lg text-ink-muted">{children}</p>
    </div>
  );
}
