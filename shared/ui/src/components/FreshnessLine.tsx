/**
 * `<FreshnessLine>` (FRONTEND.md §6.2, `GR-05`, `FR-OFF-03`).
 *
 * "A single caption beneath any live figure… Colour is muted under threshold,
 * `--warn-600` over it. Used everywhere a live number appears — this component
 * is what makes the honesty principle visible."
 *
 * It is three lines of markup and it is the most load-bearing component in the
 * product. `PRD.md` §3.2: never show a live number without saying how old it
 * is. An app that admits its data is twelve minutes stale is trusted more than
 * one that pretends; and in a hospital, a number that is silently wrong is the
 * one that gets somebody sent to the wrong ward.
 *
 * ## Why it takes `asOf` rather than reading a clock
 *
 * FRONTEND.md §11.3: "Any component displaying live data takes `asOf: Date`…
 * A component that displays a live number without `asOf` fails code review."
 * Making it a required prop is that rule, expressed where it cannot be
 * forgotten — there is no way to render this without saying what it describes.
 *
 * Never having heard from the server renders as stale, not as blank. Absence
 * of information is information (`FR-OFF-05`).
 */

import { cx } from './cx.js';

import type { ReactNode } from 'react';

export interface FreshnessLineProps {
  /** When the server last confirmed the figure. Null means it never has. */
  readonly asOf: Date | null;
  /** The instant to measure against. Passed in, so it is testable. */
  readonly now: Date;
  /** `hospital_settings.stale_threshold_minutes`, default 10 (`FR-OFF-04`). */
  readonly staleAfterMinutes?: number;
  /** Already localised by the caller — this component holds no copy. */
  readonly labels: {
    readonly justNow: string;
    /** Carries a `{time}` placeholder. */
    readonly ago: string;
    readonly never: string;
    readonly stale: string;
  };
  /** Formats the minute count — Bengali numerals on patient surfaces. */
  readonly formatMinutes: (minutes: number) => string;
}

export function FreshnessLine({
  asOf,
  now,
  staleAfterMinutes = 10,
  labels,
  formatMinutes,
}: FreshnessLineProps): ReactNode {
  if (asOf === null) {
    return (
      <p className="text-caption text-warn-600" data-testid="freshness">
        {labels.never}
      </p>
    );
  }

  const minutes = Math.max(0, Math.floor((now.getTime() - asOf.getTime()) / 60_000));
  const stale = minutes >= staleAfterMinutes;

  return (
    <p
      className={cx('text-caption', stale ? 'text-warn-600' : 'text-ink-muted')}
      data-testid="freshness"
      data-stale={stale ? 'true' : 'false'}
      // A11Y-04: the age changes on its own, so it is announced politely
      // rather than silently replaced under a screen-reader user.
      aria-live="polite"
    >
      {minutes === 0 ? labels.justNow : labels.ago.replace('{time}', formatMinutes(minutes))}
      {stale ? ` · ${labels.stale}` : ''}
    </p>
  );
}
