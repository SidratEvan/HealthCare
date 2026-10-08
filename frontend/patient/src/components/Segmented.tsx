'use client';

/**
 * `<Segmented>`: two or three views of one answer, one at a time
 * (FRONTEND.md §0.5; `TAB-A07S-*`, `TAB-A12-*`).
 *
 * A real tab list: arrow keys move between the options, the chosen one is
 * `aria-selected`, and each option names the panel it shows, so a screen
 * reader hears a set of tabs rather than a row of buttons.
 */

import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly testId?: string;
  /** The id of the panel this option shows. */
  readonly controls?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly label: string;
}): ReactNode {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    const option = options[next];
    if (option === undefined) return;
    onChange(option.value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className="grid auto-cols-fr grid-flow-col gap-1 rounded-sm bg-sunken p-1"
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={option.controls}
            tabIndex={selected ? 0 : -1}
            data-testid={option.testId}
            onClick={() => {
              onChange(option.value);
            }}
            onKeyDown={(event) => {
              move(event, index);
            }}
            className={`min-h-[40px] rounded-xs px-3 text-body-sm font-semibold transition-colors duration-instant ease-standard ${
              selected ? 'bg-surface text-brand-700 shadow-1' : 'text-ink-muted'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
