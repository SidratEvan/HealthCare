/**
 * Input (FRONTEND.md §5.2).
 *
 * ## Label, not placeholder
 *
 * §5.2: "label (always visible — never placeholder-as-label)". A placeholder
 * disappears the moment a person starts typing, which is exactly when they
 * most need to know what the field was for — and it fails every screen reader
 * that does not announce it. The label is therefore required by the type, not
 * offered as an option.
 *
 * ## Errors instruct
 *
 * §5.2: error text is instructive ("১১ সংখ্যার মোবাইল নম্বর দিন"), never
 * "Invalid input". Nothing here can enforce the wording, but the error is
 * wired to `aria-describedby` and marked `role="alert"` so that whatever is
 * written actually reaches the person who needs it.
 *
 * ## The numeric keypad
 *
 * `inputMode` is set from `kind` rather than left to the caller, because a
 * phone field that opens a full QWERTY keyboard on a cheap Android is a field
 * people mistype (§5.2).
 */

import { forwardRef, useId } from 'react';

import { cx } from './cx.js';

import type { InputHTMLAttributes, ReactNode } from 'react';

/** What the field holds, which decides the keyboard it opens. */
export type InputKind = 'text' | 'phone' | 'number' | 'search';

const INPUT_MODE: Record<InputKind, InputHTMLAttributes<HTMLInputElement>['inputMode']> = {
  text: 'text',
  phone: 'tel',
  number: 'numeric',
  search: 'search',
};

type NativeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'className' | 'type' | 'inputMode' | 'id'
>;

export interface InputProps extends NativeInputProps {
  /** Always rendered. §5.2 forbids using the placeholder as the label. */
  readonly label: string;
  readonly kind?: InputKind;
  /** Guidance shown under the field while it is valid. */
  readonly helper?: string;
  /** Instructive, never "Invalid input". Replaces the helper when set. */
  readonly error?: string;
  /** Console fields are 44px; patient fields are 52px (§5.2). */
  readonly density?: 'mobile' | 'console';
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, kind = 'text', helper, error, density = 'mobile', required, ...rest },
  ref,
) {
  const id = useId();
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const invalid = error !== undefined && error !== '';

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-ui text-body-sm font-semibold text-ink">
        {label}
        {required === true ? (
          <span aria-hidden="true" className="text-alert-600">
            {' *'}
          </span>
        ) : null}
      </label>

      <input
        {...rest}
        ref={ref}
        id={id}
        required={required}
        type={kind === 'phone' ? 'tel' : kind === 'number' ? 'text' : kind}
        inputMode={INPUT_MODE[kind]}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : helper !== undefined ? helperId : undefined}
        className={cx(
          'w-full rounded-sm border bg-surface px-4 font-ui text-body-md text-ink',
          'transition-colors duration-instant ease-standard',
          'placeholder:text-ink-muted',
          'focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-1',
          density === 'console' ? 'min-h-touch' : 'min-h-[52px]',
          invalid
            ? 'border-alert-600 focus:border-alert-600'
            : 'border-line-strong focus:border-brand-600',
        )}
      />

      {invalid ? (
        // role="alert" so the message is announced when it appears, rather
        // than only on the next focus move.
        <p id={errorId} role="alert" className="flex items-start gap-2 text-body-sm text-alert-600">
          <WarningIcon />
          {error}
        </p>
      ) : helper !== undefined ? (
        <p id={helperId} className="text-body-sm text-ink-muted">
          {helper}
        </p>
      ) : null}
    </div>
  );
});

/** Inline stroke SVG, inheriting currentColor (`ICO-01`, `ICO-02`). */
function WarningIcon(): ReactNode {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mt-[3px] shrink-0"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6" />
      <path d="M12 16.5v.5" />
    </svg>
  );
}
