/**
 * `<CapacityMirror>` — "অ্যাপে দেখাচ্ছে", what the public sees right now
 * (FRONTEND.md §6.5, `FR-BED-06`).
 *
 * "Shows staff exactly what the public sees right now, including freshness —
 * the component that makes data quality self-enforcing."
 *
 * It prints the *published* figure — the one a family's phone is showing —
 * with that figure's own age, per kind of bed. When the ward's own tiles say
 * something different (an admit still queued offline, a board the public
 * has not caught up with) it says so on the row, beside the number, in the
 * caution family: that is stale data, which is one of warn's three meanings
 * (FRONTEND.md §1.1). The point is the one `PRD.md` §3 principle 5 makes:
 * every number entered has a visible consequence, so staff keep it true.
 *
 * The component holds no copy; every string arrives localised.
 */

'use client';

import { useId } from 'react';

import { cx } from './cx.js';
import { FreshnessLine, type FreshnessLineProps } from './FreshnessLine.js';

import type { ReactNode } from 'react';

export interface CapacityMirrorRow {
  /** Stable key, e.g. the bed kind. */
  readonly key: string;
  /** Localised: "আইসিইউ". */
  readonly name: string;
  /** What the public view published (`v_public_hospital_capacity`). */
  readonly publishedFree: number;
  readonly publishedTotal: number;
  /** What this board's own tiles count, pending changes included. */
  readonly boardFree: number;
  /** When the published figure was last confirmed. Null: never. */
  readonly asOf: Date | null;
}

export interface CapacityMirrorProps {
  readonly title: string;
  /** One line under the title: why this card exists. */
  readonly subtitle: string;
  readonly rows: readonly CapacityMirrorRow[];
  readonly now: Date;
  readonly staleAfterMinutes: number;
  readonly freshnessLabels: FreshnessLineProps['labels'];
  readonly formatMinutes: (minutes: number) => string;
  /** "{free}/{total} খালি" — carries `{free}` and `{total}` placeholders. */
  readonly freeOfTotal: string;
  /** "বোর্ডে {board} — অ্যাপ এখনো পুরনো সংখ্যা দেখাচ্ছে" — carries `{board}`. */
  readonly mismatch: string;
  /** Shown when the hospital has no beds at all. */
  readonly empty: string;
  readonly formatCount: (value: number) => string;
}

export function CapacityMirror({
  title,
  subtitle,
  rows,
  now,
  staleAfterMinutes,
  freshnessLabels,
  formatMinutes,
  freeOfTotal,
  mismatch,
  empty,
  formatCount,
}: CapacityMirrorProps): ReactNode {
  const titleId = useId();

  return (
    <section
      aria-labelledby={titleId}
      data-testid="capacity-mirror"
      className="rounded-md border border-line bg-surface p-4"
    >
      <h2 id={titleId} className="font-ui text-title-sm text-ink">
        {title}
      </h2>
      <p className="font-ui text-caption text-ink-muted">{subtitle}</p>

      {rows.length === 0 ? (
        <p className="mt-3 font-ui text-body-sm text-ink-secondary">{empty}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {rows.map((row) => {
            const differs = row.boardFree !== row.publishedFree;
            return (
              <li
                key={row.key}
                data-testid={`mirror-${row.key}`}
                data-published-free={row.publishedFree}
                data-board-free={row.boardFree}
                className={cx(
                  'rounded-sm px-3 py-2',
                  differs ? 'border border-warn-border bg-warn-100' : 'bg-sunken',
                )}
              >
                <div className="flex items-baseline justify-between gap-3 font-ui">
                  <span className="text-body-sm text-ink">{row.name}</span>
                  <span className="text-body-sm font-semibold tabular-nums text-ink">
                    {freeOfTotal
                      .replace('{free}', formatCount(row.publishedFree))
                      .replace('{total}', formatCount(row.publishedTotal))}
                  </span>
                </div>
                {differs ? (
                  <p className="font-ui text-caption text-warn-700" role="status">
                    {mismatch.replace('{board}', formatCount(row.boardFree))}
                  </p>
                ) : null}
                <FreshnessLine
                  asOf={row.asOf}
                  now={now}
                  staleAfterMinutes={staleAfterMinutes}
                  labels={freshnessLabels}
                  formatMinutes={formatMinutes}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
