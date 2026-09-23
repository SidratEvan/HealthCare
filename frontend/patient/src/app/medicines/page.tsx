'use client';

/**
 * Medicine availability — the patient's half of `FR-PHR-02`.
 *
 * "Out-of-stock flagging feeds medicine availability search in the patient
 * app." This is that search: type a name, see which pharmacies say they have
 * it, and how long ago each of them said so.
 *
 * ## It is not `S-A-14`
 *
 * `APP_FLOW.md` gives `S-A-14` as *prescription QR → nearby pharmacies →
 * reserve or request delivery*, and all three of those hang off a
 * prescription. Prescribing was dropped from this version (`PRD.md` §9), so
 * the QR, the reservation and the delivery request have nothing to stand on.
 * What survives without one is the search itself, and it is worth having on
 * its own: a family holding a paper prescription from any doctor anywhere can
 * still find out who has the medicine.
 *
 * ## Three answers, never two
 *
 * A pharmacy that has not confirmed in twelve hours is shown as **জানা নেই**,
 * not as "in stock" and not as "no". Folding *unknown* into *no* invents a
 * shortage; folding it into *yes* sends somebody across Dhaka for nothing
 * (`PRD.md` §3.2). The summary line counts all three rather than reaching a
 * verdict, and every row carries the age of the claim behind it.
 *
 * ## The four states (`GR-03`)
 *
 * Nothing typed is an invitation, not an empty list. Searching is the shape
 * of a result. A failure says so and offers the retry. Offline says the
 * search needs a connection — the service worker never answers an API request
 * from a cache (`FR-OFF-03`), so there is nothing stale to show instead.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { formatSerial, tp } from '@platform/i18n';
import { Button, Card, FreshnessLine, Input } from '@platform/ui';

import { TabScreen } from '@/components/TabScreen';
import { useOnline } from '@/hooks/useOnline';
import { searchMedicines } from '@/lib/api';

import type { MedicineAvailability } from '@/lib/types';

const LOCALE = 'bn' as const;
const NUMERALS = 'bengali' as const;

/** The shortest query the API accepts (`medicineSearchQuery`). */
const MIN_QUERY = 2;

/** How long after the last keystroke the search runs. */
const DEBOUNCE_MS = 350;

type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'searching' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'ready'; readonly medicines: readonly MedicineAvailability[] };

export default function MedicinesPage(): ReactNode {
  const online = useOnline();
  const [query, setQuery] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [attempt, setAttempt] = useState(0);

  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < MIN_QUERY) {
      setState({ kind: 'idle' });
      return;
    }

    let cancelled = false;
    setState({ kind: 'searching' });

    // Debounced: a search per keystroke on a 2G connection is a screen that
    // never settles, and the API is keyed on the whole word anyway.
    const timer = setTimeout(() => {
      void searchMedicines(trimmed)
        .then((medicines) => {
          if (!cancelled) setState({ kind: 'ready', medicines });
        })
        .catch(() => {
          if (!cancelled) setState({ kind: 'failed' });
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, attempt]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  return (
    <TabScreen title={tp('medicinesTitle', LOCALE)}>
      <p className="text-body-md text-ink-secondary">{tp('medicinesIntro', LOCALE)}</p>

      <Input
        label={tp('medicinesSearch', LOCALE)}
        helper={tp('medicinesSearchHint', LOCALE)}
        value={query}
        data-testid="medicine-search"
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />

      {!online ? (
        <p
          data-testid="medicines-offline"
          className="rounded-sm bg-warn-100 px-3 py-2 text-body-sm text-warn-700"
        >
          {tp('medicinesOffline', LOCALE)}
        </p>
      ) : null}

      {state.kind === 'searching' ? (
        // GR-03 loading: the shape of the answer, never a spinner.
        <div className="flex flex-col gap-3" aria-busy="true" data-testid="medicines-loading">
          <div className="h-28 rounded-md bg-sunken" />
          <div className="h-28 rounded-md bg-sunken" />
          <span className="sr-only">{tp('medicinesSearching', LOCALE)}</span>
        </div>
      ) : null}

      {state.kind === 'failed' ? (
        <div className="flex flex-col gap-3" data-testid="medicines-error">
          <p className="rounded-sm bg-alert-100 px-3 py-2 text-body-md text-alert-700">
            {online ? tp('medicinesFailed', LOCALE) : tp('medicinesOffline', LOCALE)}
          </p>
          <Button onClick={retry} data-testid="medicines-retry">
            {tp('tryAgain', LOCALE)}
          </Button>
        </div>
      ) : null}

      {state.kind === 'ready' && state.medicines.length === 0 ? (
        <div
          data-testid="medicines-empty"
          className="rounded-md border border-line bg-surface p-5 text-body-md text-ink-secondary"
        >
          {tp('medicinesNoMatch', LOCALE)}
        </div>
      ) : null}

      {state.kind === 'ready' && state.medicines.length > 0 ? (
        <ul className="flex flex-col gap-4" data-testid="medicine-list">
          {state.medicines.map((medicine) => (
            <li key={medicine.medicineId}>
              <MedicineCard medicine={medicine} />
            </li>
          ))}
        </ul>
      ) : null}
    </TabScreen>
  );
}

/** What each answer is called, and how it is coloured. */
const ANSWER: Readonly<
  Record<string, { key: 'medicineHere' | 'medicineNotHere' | 'medicineUnknown'; className: string }>
> = {
  in_stock: { key: 'medicineHere', className: 'text-ok-700' },
  out_of_stock: { key: 'medicineNotHere', className: 'text-alert-700' },
  unknown: { key: 'medicineUnknown', className: 'text-ink-muted' },
};

function MedicineCard({ medicine }: { readonly medicine: MedicineAvailability }): ReactNode {
  const [now] = useState(() => new Date());

  const freshness = {
    justNow: tp('updatedJustNow', LOCALE),
    ago: tp('updatedAgo', LOCALE),
    never: tp('updatedNever', LOCALE),
    stale: tp('staleWarning', LOCALE),
  };
  const minutes = (value: number): string =>
    `${formatSerial(value, NUMERALS)} ${tp('minutesShort', LOCALE)}`;

  return (
    <Card>
      <div className="flex flex-col gap-3" data-testid={`medicine-${medicine.medicineId}`}>
        <div>
          <p className="text-title-sm">
            {medicine.brandName === null
              ? medicine.genericName
              : `${medicine.brandName} (${medicine.genericName})`}
          </p>
          {medicine.form === null ? null : (
            <p className="text-body-sm text-ink-muted">{medicine.form}</p>
          )}
        </div>

        {/* `GR-05`: counts, never a verdict about the whole city. */}
        <p className="text-body-sm text-ink-secondary" data-testid="medicine-summary">
          {tp('medicineSummary', LOCALE)
            .replace('{inStock}', formatSerial(medicine.summary.inStock, NUMERALS))
            .replace('{outOfStock}', formatSerial(medicine.summary.outOfStock, NUMERALS))
            .replace('{unknown}', formatSerial(medicine.summary.unknown, NUMERALS))}
        </p>

        {medicine.pharmacies.length === 0 ? (
          <p className="text-body-sm text-ink-muted">{tp('medicineNoPharmacies', LOCALE)}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {medicine.pharmacies.map((pharmacy) => {
              const answer = ANSWER[pharmacy.answer] ?? ANSWER['unknown'];
              return (
                <li
                  key={pharmacy.hospitalId}
                  className="flex flex-col gap-1 border-t border-line pt-2"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-body-md">{pharmacy.hospitalNameBn}</p>
                    <p className={`text-body-md font-semibold ${answer?.className ?? ''}`}>
                      {tp(answer?.key ?? 'medicineUnknown', LOCALE)}
                    </p>
                  </div>

                  {pharmacy.distanceKm === null ? null : (
                    <p className="text-caption text-ink-muted">
                      {tp('emergencyDistance', LOCALE).replace(
                        '{km}',
                        formatSerial(pharmacy.distanceKm, NUMERALS),
                      )}
                    </p>
                  )}

                  {/* Every live figure carries its age (CLAUDE.md §5.8). */}
                  <FreshnessLine
                    asOf={
                      pharmacy.freshness.asOf === null ? null : new Date(pharmacy.freshness.asOf)
                    }
                    now={now}
                    staleAfterMinutes={12 * 60}
                    labels={freshness}
                    formatMinutes={minutes}
                  />

                  {pharmacy.answer === 'unknown' ? (
                    <p className="text-caption text-ink-muted">
                      {tp('medicineUnknownHint', LOCALE)}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <p className="text-caption text-ink-muted">{tp('medicineCallFirst', LOCALE)}</p>
      </div>
    </Card>
  );
}
