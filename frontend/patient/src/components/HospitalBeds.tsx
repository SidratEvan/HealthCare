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
import { formatNumber, tp, formatAge, numeralsFor } from '@platform/i18n';
import { Chip, FreshnessLine, useLocale } from '@platform/ui';

import type { ReactNode } from 'react';

export function HospitalBeds({
  beds,
  now,
}: {
  readonly beds: PublicCapacity | null;
  readonly now: Date;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  // No row at all is not a figure; saying nothing is the honest render.
  if (beds === null) return null;

  if (beds.byKind.length === 0) {
    return (
      <div className="mt-2" data-testid="card-beds">
        <Chip tone="neutral">{tp('cardNoBeds', locale)}</Chip>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-1" data-testid="card-beds">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={beds.bedFree > 0 ? 'positive' : 'neutral'}>
          {tp('cardBedsFree', locale).replace('{free}', formatNumber(beds.bedFree, numerals))}
        </Chip>
        <Chip tone={(beds.icuFree ?? 0) > 0 ? 'positive' : 'neutral'}>
          {beds.icuTotal === null
            ? tp('cardNoIcu', locale)
            : tp('cardIcu', locale)
                .replace('{free}', formatNumber(beds.icuFree ?? 0, numerals))
                .replace('{total}', formatNumber(beds.icuTotal, numerals))}
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
