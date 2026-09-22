/**
 * `<BedTile>` — one bed on the ward board (FRONTEND.md §6.5, `BTN-B06-BED-<bedId>`).
 *
 * "Tiles carry state by fill colour with a text label inside (never colour
 * alone, for accessibility)." The state's name is always printed on the tile,
 * so a nurse who cannot tell the fills apart — or is reading a monitor in a
 * sunlit corridor — reads the word instead (`A11Y-03`).
 *
 * ## Why the colours are what they are
 *
 * `FRONTEND.md` §1.1's colour law decides this more than taste does:
 *
 *   - **free** is the brand's tinted surface. Green is "live / positive
 *     state", and a free bed is the most positive thing this board can say.
 *   - **reserved** keeps the brand as an outline only: a promise, not yet a
 *     patient.
 *   - **occupied** is the plain surface. Most beds are occupied most of the
 *     time, and the ordinary case should be the quiet one.
 *   - **cleaning** and **out of service** are neutral, told apart by their
 *     labels and by the dashed edge on a bed that cannot be used at all.
 *
 * Neither uses `--warn-*` or `--alert-*`. Warn carries exactly three meanings
 * — delay, stale data, a late patient — and red is reserved for emergencies.
 * A dirty bed is neither.
 *
 * A tile whose change has not reached the server yet carries a small clock,
 * the same glyph `<QueueTable>` uses for a pending row, rather than a colour
 * change (FRONTEND.md §6.4).
 *
 * ## It holds no copy
 *
 * Every string arrives already localised, like `<FreshnessLine>`'s labels, so
 * this component never decides what a bed is called in Bangla.
 */

'use client';

import { cx } from './cx.js';

import type { ReactNode } from 'react';

export type BedTileState = 'free' | 'occupied' | 'cleaning' | 'reserved' | 'out_of_service';

const TONE: Record<BedTileState, string> = {
  free: 'bg-brand-100 border-brand-border text-brand-700',
  reserved: 'bg-surface border-2 border-brand-600 text-brand-700',
  occupied: 'bg-surface border-line-strong text-ink',
  cleaning: 'bg-sunken border-line text-ink-secondary',
  out_of_service: 'bg-sunken border-dashed border-line-strong text-ink-muted',
};

export interface BedTileProps {
  /** What is painted on the wall: "301", "ICU-04". */
  readonly label: string;
  readonly state: BedTileState;
  /** The state, in words. Required: colour never carries meaning alone. */
  readonly stateLabel: string;
  /** One line of context — "৪ দিন", "১০:৩০ পর্যন্ত", a reason. */
  readonly detail?: string | undefined;
  readonly selected: boolean;
  /** True while this bed's change is queued and not yet on the server. */
  readonly pending?: boolean | undefined;
  /** Announced beside a pending tile, e.g. "সার্ভারে পাঠানো বাকি". */
  readonly pendingLabel?: string | undefined;
  readonly onSelect: () => void;
}

export function BedTile({
  label,
  state,
  stateLabel,
  detail,
  selected,
  pending = false,
  pendingLabel,
  onSelect,
}: BedTileProps): ReactNode {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid={`bed-tile-${label}`}
      data-state={state}
      data-pending={pending ? 'true' : 'false'}
      className={cx(
        'relative flex min-h-touch w-full flex-col items-start gap-1 rounded-md border p-3 text-left',
        'font-ui transition-colors duration-quick ease-standard',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2',
        TONE[state],
        selected && 'ring-2 ring-brand-600 ring-offset-2',
      )}
    >
      <span className="text-title-sm font-semibold tabular-nums">{label}</span>
      <span className="text-caption font-medium">{stateLabel}</span>
      {detail === undefined || detail === '' ? null : (
        <span className="line-clamp-1 text-caption text-ink-muted">{detail}</span>
      )}
      {pending ? (
        <span className="absolute right-2 top-2" role="img" aria-label={pendingLabel ?? ''}>
          <ClockGlyph />
        </span>
      ) : null}
    </button>
  );
}

/** The pending-sync mark: an inline stroke icon, not an emoji (FRONTEND.md §0.2). */
function ClockGlyph(): ReactNode {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
