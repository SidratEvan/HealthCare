'use client';

/**
 * The bed line on a hospital card (`FR-PAT-14`): "Hospital cards show … free
 * beds, ICU count, and a freshness stamp."
 *
 * Three answers are kept apart, because each sends a family somewhere
 * different: *no inpatient beds here*, *no ICU here*, and *none free*. And the
 * figures carry their own age — the oldest kind's, because a total built
 * partly from a ward nobody has confirmed for hours is that old in part
 * (`v_public_hospital_capacity`, `PRD.md` §3.2).
 *
 * A fourth, since a hospital chooses what it shares (`FR-NET-04`): *it has
 * beds and does not share the figure*. That is said, and is none of the
 * other three.
 *
 * And a count is said only while it is fresh (owner, 8 October; `bedFigure`):
 * past the threshold the chip says it is not known, beside the age of the
 * last confirmation, and never a number.
 */

import {
  bedFigure,
  DEFAULT_STALE_THRESHOLD_MINUTES,
  timestamp,
  type BedFigure,
  type PublicCapacity,
} from '@platform/domain';
import { formatNumber, tp, formatAge, numeralsFor } from '@platform/i18n';
import { Chip, FreshnessLine, useLocale } from '@platform/ui';

import { NotShared } from '@/components/NotShared';

import type { ReactNode } from 'react';

export function HospitalBeds({
  beds,
  notShared = false,
  now,
}: {
  readonly beds: PublicCapacity | null;
  /** The hospital runs beds and keeps the figure to itself. */
  readonly notShared?: boolean;
  readonly now: Date;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  if (notShared) {
    return (
      <div className="mt-2" data-testid="card-beds">
        <NotShared figure="beds" />
      </div>
    );
  }
  // No row at all is not a figure; saying nothing is the honest render.
  if (beds === null) return null;

  if (beds.byKind.length === 0) {
    return (
      <div className="mt-2" data-testid="card-beds">
        <Chip tone="neutral">{tp('cardNoBeds', locale)}</Chip>
      </div>
    );
  }

  const at = timestamp(now.toISOString());
  const all = bedFigure(beds.bedFree, beds.bedsAsOf, at, DEFAULT_STALE_THRESHOLD_MINUTES);
  const icu = bedFigure(beds.icuFree, beds.icuAsOf, at, DEFAULT_STALE_THRESHOLD_MINUTES);

  return (
    <div className="mt-2 flex flex-col gap-1" data-testid="card-beds">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={toneOf(all)}>
          {all.kind === 'count'
            ? tp('cardBedsFree', locale).replace('{free}', formatNumber(all.free, numerals))
            : tp('bedsUnknown', locale)}
        </Chip>
        <Chip tone={beds.icuTotal === null ? 'neutral' : toneOf(icu)}>
          {beds.icuTotal === null
            ? tp('cardNoIcu', locale)
            : icu.kind === 'count'
              ? tp('cardIcu', locale)
                  .replace('{free}', formatNumber(icu.free, numerals))
                  .replace('{total}', formatNumber(beds.icuTotal, numerals))
              : tp('icuUnknown', locale)}
        </Chip>
      </div>
      <FreshnessLine
        asOf={beds.bedsAsOf === null ? null : new Date(beds.bedsAsOf)}
        now={now}
        labels={{
          justNow: tp('updatedJustNow', locale),
          ago: tp('updatedAgo', locale),
          never: tp('updatedNever', locale),
          stale: tp('staleWarning', locale),
        }}
        formatMinutes={(value) => formatAge(value, locale, numerals)}
      />
    </div>
  );
}

/** Green only for beds free now. */
function toneOf(figure: BedFigure): 'positive' | 'neutral' {
  return figure.kind === 'count' && figure.free > 0 ? 'positive' : 'neutral';
}
