'use client';

/**
 * `S-B-07`'s right column: what the ER tells the network, and what the ward
 * tells the ER.
 *
 * **Capabilities** (`SW-B07-<capability>`, `FR-EMG-05`): "toggled by the
 * coordinator, published to the network within seconds". A switch publishes
 * its own row the moment it is flipped — the public reads the view on every
 * search, so the next family to search sees it. "Confirm" re-sends the whole
 * list unchanged, which is how a coordinator says "still true" and renews the
 * age a family sees beside it (`FR-PAT-45`).
 *
 * **Beds** — "ICU/bed counters: read from the bed board, not typed twice".
 * The published figure for each kind, with its own age: the ER is reading the
 * same number a family is, and should see how old it is too.
 */

import type { CapabilityState } from '@platform/client';
import type { PublicCapacity } from '@platform/domain';
import {
  bedKindName,
  capabilityName,
  format,
  formatNumber,
  t,
  type CapabilityName,
  type Locale,
} from '@platform/i18n';
import { Button, FreshnessLine } from '@platform/ui';

import { NUMERALS } from '@/lib/bedCopy';

import type { ReactNode } from 'react';

interface FreshnessCopy {
  readonly justNow: string;
  readonly ago: string;
  readonly never: string;
  readonly stale: string;
}

export function CapabilityPanel({
  capabilities,
  pending,
  locale,
  now,
  staleAfterMinutes,
  freshness,
  minutes,
  onToggle,
  onConfirmAll,
}: {
  readonly capabilities: readonly CapabilityState[];
  readonly pending: boolean;
  readonly locale: Locale;
  readonly now: Date;
  readonly staleAfterMinutes: number;
  readonly freshness: FreshnessCopy;
  readonly minutes: (value: number) => string;
  readonly onToggle: (kind: string, available: boolean) => void;
  readonly onConfirmAll: () => void;
}): ReactNode {
  return (
    <section
      aria-labelledby="er-capabilities-title"
      data-testid="er-capabilities"
      className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4 font-ui"
    >
      <div>
        <h2 id="er-capabilities-title" className="text-title-sm text-ink">
          {t('erCapabilitiesTitle', locale)}
        </h2>
        <p className="text-caption text-ink-muted">{t('erCapabilitiesHint', locale)}</p>
      </div>

      {capabilities.length === 0 ? (
        <p className="text-body-sm text-ink-secondary">{t('erCapabilitiesNone', locale)}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {capabilities.map((row) => (
            <li key={row.kind} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-body-md text-ink">
                  {capabilityName(row.kind as CapabilityName, locale)}
                </p>
                <FreshnessLine
                  asOf={new Date(row.updatedAt)}
                  now={now}
                  staleAfterMinutes={staleAfterMinutes}
                  labels={freshness}
                  formatMinutes={minutes}
                />
              </div>
              {/* SW-B07-<capability>: a real switch, said in words as well as position. */}
              <button
                type="button"
                role="switch"
                aria-checked={row.available}
                data-testid={`er-capability-${row.kind}`}
                onClick={() => {
                  onToggle(row.kind, !row.available);
                }}
                className={
                  row.available
                    ? 'min-h-touch shrink-0 rounded-pill bg-brand-600 px-4 text-body-sm font-semibold text-surface'
                    : 'min-h-touch shrink-0 rounded-pill border border-line-strong bg-sunken px-4 text-body-sm text-ink-secondary'
                }
              >
                {row.available ? t('erCapabilityOn', locale) : t('erCapabilityOff', locale)}
              </button>
            </li>
          ))}
        </ul>
      )}

      {capabilities.length === 0 ? null : (
        <Button
          size="sm"
          variant="secondary"
          data-testid="er-capabilities-confirm"
          onClick={onConfirmAll}
        >
          {t('erCapabilitiesConfirm', locale)}
        </Button>
      )}
      {pending ? (
        <p className="text-caption text-ink-muted">{t('bedPendingSync', locale)}</p>
      ) : null}
    </section>
  );
}

export function ErBeds({
  published,
  locale,
  now,
  staleAfterMinutes,
  freshness,
  minutes,
}: {
  readonly published: PublicCapacity | null;
  readonly locale: Locale;
  readonly now: Date;
  readonly staleAfterMinutes: number;
  readonly freshness: FreshnessCopy;
  readonly minutes: (value: number) => string;
}): ReactNode {
  const kinds = published?.byKind ?? [];

  return (
    <section
      aria-labelledby="er-beds-title"
      data-testid="er-beds"
      className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4 font-ui"
    >
      <h2 id="er-beds-title" className="text-title-sm text-ink">
        {t('erBedsTitle', locale)}
      </h2>

      {kinds.length === 0 ? (
        <p className="text-body-sm text-ink-secondary">{t('mirrorEmpty', locale)}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {kinds.map((entry) => (
            <li key={entry.kind} data-testid={`er-beds-${entry.kind}`}>
              <div className="flex justify-between gap-3">
                <span className="text-body-md text-ink">{bedKindName(entry.kind, locale)}</span>
                <span className="text-body-md tabular-nums text-ink">
                  {format('mirrorFreeOfTotal', locale, {
                    free: formatNumber(entry.free, NUMERALS),
                    total: formatNumber(entry.total, NUMERALS),
                  })}
                </span>
              </div>
              <FreshnessLine
                asOf={entry.asOf === null ? null : new Date(entry.asOf)}
                now={now}
                staleAfterMinutes={staleAfterMinutes}
                labels={freshness}
                formatMinutes={minutes}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
