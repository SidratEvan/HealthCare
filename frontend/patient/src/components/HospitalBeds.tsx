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
 */

import type { PublicCapacity } from '@platform/domain';
import { formatNumber, tp, formatAge } from '@platform/i18n';
import { Chip, FreshnessLine } from '@platform/ui';

import type { ReactNode } from 'react';

const LOCALE = 'bn' as const;

/** Patient surfaces use Bengali numerals (`TYP-04`). */
const NUMERALS = 'bengali' as const;

export function HospitalBeds({
  beds,
  now,
}: {
  readonly beds: PublicCapacity | null;
  readonly now: Date;
}): ReactNode {
  // No row at all is not a figure; saying nothing is the honest render.
  if (beds === null) return null;

  if (beds.byKind.length === 0) {
    return (
      <div className="mt-2" data-testid="card-beds">
        <Chip tone="neutral">{tp('cardNoBeds', LOCALE)}</Chip>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-1" data-testid="card-beds">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={beds.bedFree > 0 ? 'positive' : 'neutral'}>
          {tp('cardBedsFree', LOCALE).replace('{free}', formatNumber(beds.bedFree, NUMERALS))}
        </Chip>
        <Chip tone={(beds.icuFree ?? 0) > 0 ? 'positive' : 'neutral'}>
          {beds.icuTotal === null
            ? tp('cardNoIcu', LOCALE)
            : tp('cardIcu', LOCALE)
                .replace('{free}', formatNumber(beds.icuFree ?? 0, NUMERALS))
                .replace('{total}', formatNumber(beds.icuTotal, NUMERALS))}
        </Chip>
      </div>
      <FreshnessLine
        asOf={beds.bedsAsOf === null ? null : new Date(beds.bedsAsOf)}
        now={now}
        labels={{
          justNow: tp('updatedJustNow', LOCALE),
          ago: tp('updatedAgo', LOCALE),
          never: tp('updatedNever', LOCALE),
          stale: tp('staleWarning', LOCALE),
        }}
        formatMinutes={(value) => formatAge(value, LOCALE, NUMERALS)}
      />
    </div>
  );
}
