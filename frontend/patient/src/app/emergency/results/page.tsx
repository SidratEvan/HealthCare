'use client';

/**
 * `S-A-10b` Emergency results (`APP_FLOW.md` A6, `FR-PAT-41`, `FR-PAT-43..46`).
 *
 * "Ranking: capability match → travel time → ER load → free beds. Stale
 * facilities are de-ranked and labelled." The order is the server's, decided
 * by `shared/domain/src/emergency/ranking.ts`; this screen draws it.
 *
 * ## Two modes, from `S-A-10`'s split (`FR-PAT-41`)
 *
 * **Critical** (`?mode=critical`): "an immediate call action and the nearest
 * capable facility, with no browsing required". The call first, then one card
 * — the top of the ranking — and the problem chips beneath it, which narrow
 * that one answer to the nearest facility able to treat the problem.
 *
 * **Urgent** (`?problem=burn`): the full ranked list, the first card drawn as
 * the answer.
 *
 * ## Honest degradation
 *
 * - No position (refused, or no fix in eight seconds): the search runs anyway,
 *   ranked on everything but distance, and says so. A distance is never shown
 *   that was not measured.
 * - Offline: the last list this phone saw for the same problem, with its age,
 *   and the instruction to call — "I'm on my way" cannot reach anybody
 *   (`FR-OFF-02`). With no list, the call alone.
 * - The list re-reads every thirty seconds while visible, as the bed search
 *   does: there is no public socket (`docs/STATUS.md`, decision 35).
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { EMERGENCY_PROBLEMS, type EmergencyProblem } from '@platform/domain';
import { formatAge, problemName, tp } from '@platform/i18n';
import { Button, FreshnessLine } from '@platform/ui';

import { EmergencyResultCard } from '@/components/EmergencyResult';
import { TabScreen } from '@/components/TabScreen';
import { useNow } from '@/hooks/useNow';
import { useOnline } from '@/hooks/useOnline';
import { usePosition } from '@/hooks/usePosition';
import { emergencySearch } from '@/lib/api';
import { lastSearch, rememberSearch } from '@/lib/emergency';

import type { EmergencySearchResult } from '@/lib/types';

const LOCALE = 'bn' as const;
const NUMERALS = 'bengali' as const;
const REFRESH_MS = 30_000;

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'failed' }
  | { readonly state: 'ready'; readonly search: EmergencySearchResult; readonly cached: boolean };

function isProblem(value: string | null): value is EmergencyProblem {
  return value !== null && (EMERGENCY_PROBLEMS as readonly string[]).includes(value);
}

export default function Page(): ReactNode {
  const now = useNow(1_000);
  const online = useOnline();
  const { position, retry: retryPosition } = usePosition();

  const [query, setQuery] = useState<{
    readonly problem: EmergencyProblem | null;
    readonly critical: boolean;
  } | null>(null);
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });

  // Read after mount: the server has no `location`.
  useEffect(() => {
    const params = new URLSearchParams(globalThis.location.search);
    const problem = params.get('problem');
    setQuery({
      problem: isProblem(problem) ? problem : null,
      critical: params.get('mode') === 'critical',
    });
  }, []);

  const lat = position.kind === 'found' ? position.lat : null;
  const lng = position.kind === 'found' ? position.lng : null;
  const located = lat === null || lng === null ? null : { lat, lng };
  const locating = position.kind === 'locating';

  const load = useCallback(async () => {
    if (query === null || locating) return;
    try {
      const search = await emergencySearch({
        problem: query.problem,
        position: lat === null || lng === null ? null : { lat, lng },
      });
      rememberSearch(search);
      setLoaded({ state: 'ready', search, cached: false });
    } catch {
      // The last list for this problem, with its age, beats a blank screen in
      // an emergency — and says it is the last one (`FR-OFF-02`).
      const cached = lastSearch(query.problem);
      setLoaded((current) =>
        current.state === 'ready'
          ? { ...current, cached: true }
          : cached === null
            ? { state: 'failed' }
            : { state: 'ready', search: cached, cached: true },
      );
    }
  }, [query, locating, lat, lng]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (globalThis.document?.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [load]);

  const problem = query?.problem ?? null;
  const critical = query?.critical ?? false;

  const title =
    problem === null
      ? tp('emergencyNearestTitle', LOCALE)
      : tp('emergencyResultsFor', LOCALE).replace('{problem}', problemName(problem, LOCALE));

  return (
    <TabScreen title={title}>
      {/* FR-PAT-47: the national number, on every emergency screen. */}
      <Call999 />

      {position.kind === 'locating' ? (
        <p className="text-body-md text-ink-secondary" role="status" data-testid="locating">
          {tp('emergencyLocating', LOCALE)}
        </p>
      ) : position.kind === 'unavailable' ? (
        <div className="flex flex-col gap-2 rounded-md bg-sunken p-3" data-testid="no-location">
          <p className="text-body-sm text-ink-secondary">{tp('emergencyNoLocation', LOCALE)}</p>
          <div>
            <Button variant="secondary" size="sm" onClick={retryPosition}>
              {tp('emergencyTryLocation', LOCALE)}
            </Button>
          </div>
        </div>
      ) : null}

      <Results
        loaded={loaded}
        problem={problem}
        critical={critical}
        online={online}
        position={located}
        now={now}
        onRetry={() => {
          setLoaded({ state: 'loading' });
          void load();
        }}
      />

      {/* FR-PAT-41: a critical answer narrows by problem without browsing. */}
      {critical ? (
        <section aria-labelledby="narrow-title" className="flex flex-col gap-3">
          <h2 id="narrow-title" className="text-title-sm text-ink">
            {tp('emergencyWhatHappened', LOCALE)}
          </h2>
          <ul className="grid grid-cols-2 gap-2">
            {EMERGENCY_PROBLEMS.map((candidate) => (
              <li key={candidate}>
                <a
                  href={`/emergency/results?mode=critical&problem=${candidate}`}
                  data-testid={`narrow-${candidate}`}
                  aria-current={candidate === problem ? 'page' : undefined}
                  className="flex min-h-touch items-center justify-center rounded-md border border-line-strong bg-surface px-3 text-body-md text-ink aria-[current=page]:border-alert-600 aria-[current=page]:bg-alert-100"
                >
                  {problemName(candidate, LOCALE)}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* FR-PAT-47: and the ambulance (BTN-A10-AMB; the flow is step 17). */}
      <a
        href="/ambulance"
        className="flex min-h-touch items-center justify-center rounded-md border border-line px-4 text-body-md text-ink"
      >
        {tp('emergencyAmbulance', LOCALE)}
      </a>
    </TabScreen>
  );
}

function Results({
  loaded,
  problem,
  critical,
  online,
  position,
  now,
  onRetry,
}: {
  readonly loaded: Loaded;
  readonly problem: EmergencyProblem | null;
  readonly critical: boolean;
  readonly online: boolean;
  readonly position: { readonly lat: number; readonly lng: number } | null;
  readonly now: Date;
  readonly onRetry: () => void;
}): ReactNode {
  if (loaded.state === 'loading') {
    // GR-03 loading: the shape of the answer.
    return (
      <div className="flex flex-col gap-3" aria-busy="true" data-testid="results-loading">
        <div className="h-56 rounded-lg bg-sunken" />
        <div className="h-40 rounded-lg bg-sunken" />
      </div>
    );
  }

  if (loaded.state === 'failed') {
    return (
      <div className="flex flex-col gap-3" role="alert" data-testid="results-failed">
        <p className="text-body-md text-ink-secondary">
          {online ? tp('listFailed', LOCALE) : tp('emergencyOfflineNoList', LOCALE)}
        </p>
        <div>
          <Button variant="secondary" onClick={onRetry}>
            {tp('tryAgain', LOCALE)}
          </Button>
        </div>
      </div>
    );
  }

  const { search, cached } = loaded;
  const stale = cached || !online;
  const results = critical ? search.results.slice(0, 1) : search.results;

  if (results.length === 0) {
    return (
      <p className="text-body-md text-ink-secondary" data-testid="results-empty">
        {tp('emergencyNoResults', LOCALE)}
      </p>
    );
  }

  const [lead, ...rest] = results;

  return (
    <div className="flex flex-col gap-4" data-testid="results">
      {stale ? (
        <p
          role="status"
          className="rounded-md bg-warn-100 px-3 py-2 text-body-sm text-warn-700"
          data-testid="results-offline"
        >
          {tp('emergencyOffline', LOCALE)}
        </p>
      ) : null}

      {/* The list's own age: when this answer was given. */}
      <FreshnessLine
        asOf={new Date(search.serverTs)}
        now={now}
        labels={{
          justNow: tp('updatedJustNow', LOCALE),
          ago: tp('updatedAgo', LOCALE),
          never: tp('updatedNever', LOCALE),
          stale: tp('staleWarning', LOCALE),
        }}
        formatMinutes={(value) => formatAge(value, LOCALE, NUMERALS)}
      />

      {lead === undefined ? null : (
        <section aria-labelledby="lead-title" className="flex flex-col gap-2">
          <h2 id="lead-title" className="text-title-sm text-ink">
            {problem === null
              ? tp('emergencyBestNow', LOCALE)
              : tp('emergencyNearestCapable', LOCALE).replace(
                  '{problem}',
                  problemName(problem, LOCALE),
                )}
          </h2>
          <EmergencyResultCard
            result={lead}
            problem={problem ?? 'other'}
            position={position}
            now={now}
            lead
            offline={stale}
            onSent={onSent}
          />
        </section>
      )}

      {rest.length === 0 ? null : (
        <section aria-labelledby="others-title" className="flex flex-col gap-3">
          <h2 id="others-title" className="text-title-sm text-ink">
            {tp('emergencyOtherHospitals', LOCALE)}
          </h2>
          {rest.map((result) => (
            <EmergencyResultCard
              key={result.hospitalId}
              result={result}
              problem={problem ?? 'other'}
              position={position}
              now={now}
              lead={false}
              offline={stale}
              onSent={onSent}
            />
          ))}
        </section>
      )}
    </div>
  );
}

/** Straight to `S-A-10c`, whose link is also in the SMS if a number was left. */
function onSent(token: string): void {
  globalThis.location.assign(`/emergency/onway?t=${encodeURIComponent(token)}`);
}

/** `FR-PAT-47`: the national number, on every emergency screen. */
function Call999(): ReactNode {
  return (
    <a
      href="tel:999"
      data-testid="results-call-999"
      className="flex min-h-[60px] items-center justify-center rounded-lg bg-alert-600 px-5 font-reading text-title-md font-bold text-white"
    >
      {tp('call999', LOCALE)}
    </a>
  );
}
