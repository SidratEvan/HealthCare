/**
 * Chip and status pill (FRONTEND.md §5.5).
 *
 * "Four semantic families only… A chip never carries an action — chips inform;
 * buttons act. Filter chips are the one exception and use `radius-pill` to be
 * visually distinct from status pills."
 *
 * So there are two components here rather than one with an `onClick`. `Chip`
 * renders a `<span>` and has no click handler in its type; `FilterChip`
 * renders a real `<button>` with `aria-pressed`. The distinction is not
 * cosmetic — a status a screen reader announces as a button is a status
 * somebody will try to press.
 */

import { cx } from './cx.js';

import type { ReactNode } from 'react';

/** The four families §5.5 permits. There is no fifth. */
export type ChipTone = 'neutral' | 'positive' | 'caution' | 'alert';

const TONE: Record<ChipTone, string> = {
  neutral: 'bg-sunken text-ink',
  positive: 'bg-brand-100 text-brand-700',
  caution: 'bg-warn-100 text-warn-700',
  alert: 'bg-alert-100 text-alert-700',
};

export interface ChipProps {
  readonly children: ReactNode;
  readonly tone?: ChipTone;
  /**
   * Announced instead of the visible text where the label alone is not
   * enough — "দেরিতে" reads as a word, not as a queue state, out of context.
   */
  readonly label?: string;
}

export function Chip({ children, tone = 'neutral', label }: ChipProps): ReactNode {
  return (
    <span
      // §5.5: 12px caption, 6/10px padding, radius-xs.
      className={cx(
        'inline-flex items-center rounded-xs px-[10px] py-[6px] font-ui text-caption font-medium',
        TONE[tone],
      )}
      aria-label={label}
    >
      {children}
    </span>
  );
}

export interface FilterChipProps {
  readonly children: ReactNode;
  readonly selected: boolean;
  readonly onToggle: () => void;
}

/**
 * The one chip that acts.
 *
 * `radius-pill` rather than `radius-xs`, so it cannot be mistaken for a status
 * pill at a glance, and a real `<button>` with `aria-pressed` so it is
 * reachable by keyboard and announced as a toggle.
 */
export function FilterChip({ children, selected, onToggle }: FilterChipProps): ReactNode {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={cx(
        'inline-flex min-h-touch items-center rounded-pill border px-4 font-ui text-body-sm',
        'transition-colors duration-instant ease-standard',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2',
        selected
          ? 'border-brand-600 bg-brand-600 text-white'
          : 'border-line-strong bg-surface text-ink hover:bg-sunken',
      )}
    >
      {children}
    </button>
  );
}
